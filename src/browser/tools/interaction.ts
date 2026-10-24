// dsh-browser · 浏览器工具 — 页面元素交互、表单与文件处理
import { existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Locator, Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, FormField } from "../types.js";
import {
  getPage, activePage, pageRef, pageIdentity,
  savedForms, lastFormFields, setLastFormFields,
  downloadsOf, currentProfile, networkEntries,
  targetLocator, resolveTargetLocator,
} from "../session.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { withTimeout, unwrapDoubleEncodedScript, workspaceFilePath } from "./common.js";
import { somFallbackShot } from "./inspection.js";
import {
  isElementDisabled,
  waitForDOMQuiescence,
  liftTargetIfHiddenInput,
  isMaskInterceptionError,
  beginChangeWatch, endChangeWatch,
  executeUniversalSelect,
  fillEditorHelper,
  fillFormFieldHelper,
  transferItemsHelper,
  dragAndDropHelper,
  type FormFillResult,
} from "../primitives/index.js";
import * as primitives from "../primitives/index.js";
import { humanClick } from "../stealth/mouse.js";
import { humanType } from "../stealth/keyboard.js";

export { targetLocator, resolveTargetLocator };

export function isBotSensitiveUrl(url: string): boolean {
  if (!url) return false;
  return /login|signin|auth|captcha|challenge|turnstile|security|waf/i.test(url);
}

/**
 * 语义定位(what)零命中时的 SoM 兜底:截一张带标徽的视口图并附到错误消息,
 * 多模态模型可看图后 browser_click { mark: N } 一次往返完成定位。
 * config.somFallback === false 关闭;截图失败静默(不放大错误)。
 */
async function enrichSemanticMiss(
  e: unknown,
  config: BrowserConfig,
  exec?: ToolRunContext,
): Promise<unknown> {
  const miss = (e as { semanticMiss?: unknown })?.semanticMiss;
  if (miss === undefined || config.somFallback === false) return e;
  const shot = await somFallbackShot(config, exec);
  if (shot === null) return e;
  const err = new Error(
    `${e instanceof Error ? e.message : String(e)};已附 SoM 标徽截图(多模态看图后可用 browser_click { mark: N } 精准点击): ${shot.screenshot} — 标徽: ${shot.marks.map((m) => `${m.id}=${m.role} "${m.name}"`).slice(0, 20).join("; ") || "(无标徽)"}`,
  );
  (err as any).semanticMiss = miss;
  (err as any).vlm = shot;
  return err;
}

export async function clickTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  let targetRes;
  try {
    targetRes = await resolveTargetLocator(page, args);
  } catch (e) {
    throw await enrichSemanticMiss(e, config, exec);
  }
  let target = targetRes.locator;
  const label = String(args.ref ?? args.selector ?? args.mark ?? args.what ?? "");

  // 1. 隐藏 input 点击目标提升 (Target Lifting)
  target = await liftTargetIfHiddenInput(target);

  // 效果验证前置:变化记录必须在点击**之前**装表(同步 DOM 变化点击瞬间即发生)
  const wantEffect = args.effect === true;
  let urlBefore = "";
  let effectStart = 0;
  if (wantEffect) {
    urlBefore = page.url();
    effectStart = Date.now();
    await beginChangeWatch(page);
  }

  const isHuman =
    args.humanize === true ||
    (args.humanize === undefined &&
      (config.humanize === true || (config.humanize === "auto" && isBotSensitiveUrl(page.url()))));

  try {
    let clickedHuman = false;
    if (isHuman && args.force !== true) {
      clickedHuman = await humanClick(page, target, { speed: config.humanizeSpeed });
    }
    if (!clickedHuman) {
      const explicitTimeout = args.timeoutMs !== undefined;
      const timeoutMs = explicitTimeout ? Number(args.timeoutMs) : (config.timeoutMs ?? 30000);
      // 快速探测与稳妥重试：若未显式指定长超时，先尝试 5s 快速探测；若因浮层遮挡或微动画导致超时，
      // 自动降级为 force: true 重试，避免白等 30s。
      try {
        const firstTimeout = explicitTimeout ? timeoutMs : Math.min(timeoutMs, 5000);
        await target.click({ timeout: firstTimeout, force: args.force === true });
      } catch (firstErr) {
        // 快速检测是否为禁用元素：若是禁用状态，则无需做无谓的 force 穿透重试，直接抛出高导向性错误
        const hasElem = (await target.count().catch(() => 0)) > 0;
        const isDisabled = hasElem
          ? await withTimeout(target.first().evaluate(isElementDisabled), 1_000, "检测禁用状态").catch(() => false)
          : false;

        if (isDisabled) {
          throw new Error(
            `目标元素当前处于禁用状态 (disabled/aria-disabled/disabled class)，无法执行点击操作。提示：前置业务条件可能未满足（例如未勾选前置表格行、或表单必填项尚未完整填写）`,
          );
        }

        if (!explicitTimeout && args.force !== true) {
          await target.click({ timeout: 3000, force: true });
        } else {
          throw firstErr;
        }
      }
    }
  } catch (e) {
    // 2. 遮罩层动画拦截自愈
    let healed = false;
    if (isMaskInterceptionError(e as Error)) {
      await page.waitForTimeout(100);
      try {
        await target.click({ timeout: 3000, force: true });
        healed = true;
      } catch {
        // 恢复失败，继续走常规诊断
      }
    }

    if (!healed) {
      // 超时诊断:区分「元素没匹配到」与「匹配到但不可交互」;点击引发的导航竞态
      // (事件已派发但 promise 超时)给提示,让 agent 用 snapshot 确认实际状态。
      const msg = e instanceof Error ? e.message : String(e);
      let diag = "";
      try {
        const n = await target.count();
        if (n === 0) diag = "元素未匹配(selector 可能写错或元素未渲染)";
        else {
          const visible = await target.first().isVisible();
          const isDisabled = await withTimeout(target.first().evaluate(isElementDisabled), 1_000, "检测禁用状态").catch(() => false);
          if (isDisabled) {
            diag = "目标元素当前处于禁用状态 (disabled/aria-disabled/disabled class)，无法执行操作。提示：前置业务条件可能未满足（例如未勾选前置表格行、或表单必填项尚未完整填写）";
          } else {
            diag = visible ? "元素可见但不可交互(被遮挡或有透明遮罩);若页面刚发生跳转,点击可能实际已生效" : "元素存在但不可见";
          }
          if (targetRes.matchedCount !== undefined && targetRes.matchedCount > 1) {
            diag += ` (当前选择器在页面中匹配到了 ${targetRes.matchedCount} 个元素，其中可见 ${targetRes.visibleCount ?? 0} 个；可能存在隐藏同构节点干扰，建议优先使用特异性属性如 [data-menu-id] 或通过 browser_snapshot 提取 [ref])`;
          }
        }
      } catch {
        diag = "元素已从页面移除(若页面刚发生跳转,点击可能实际已生效)";
      }
      throw new Error(`click 失败: ${label} — ${diag};原始错误: ${msg}`);
    }
  }

  // 3. 稳态等待（兼顾传统整页导航与 SPA 单页渲染）
  await Promise.race([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    waitForDOMQuiescence(page, { quietMs: 60 }),
  ]);

  // 4. 点击效果验证(effect: true):收口「点出了什么动静」——DOM 变化摘要
  // (点击前已装表)+ URL 变化 + 该 profile 点击后新增的网络请求。语义多候选
  // 场景下首击无动静自动换次候选再试一次(最多 1 次,标 switchedCandidate)。
  if (wantEffect) {
    const digest = await endChangeWatch(page, { graceMs: 600 });
    let switchedCandidate = false;
    let finalDigest = digest;
    if (!digest.domChanged && page.url() === urlBefore && (targetRes.alternates?.length ?? 0) > 0) {
      const alt = targetRes.alternates![0]!;
      await beginChangeWatch(page);
      try {
        await alt.click({ timeout: 3000 });
        switchedCandidate = true;
        finalDigest = await endChangeWatch(page, { graceMs: 600 });
      } catch {
        /* 备选点击失败:维持首击结果,不放大 */
      }
    }
    const urlAfter = page.url();
    const newRequests = networkEntries(currentProfile)
      .filter((n) => n.startedAt >= effectStart)
      .slice(-10)
      .map((n) => ({ url: n.url, method: n.method, ...(n.status !== undefined ? { status: n.status } : {}) }));
    const effect = {
      domChanged: finalDigest.domChanged,
      ...(finalDigest.mutations.length > 0 ? { mutations: finalDigest.mutations } : {}),
      urlChanged: urlAfter !== urlBefore,
      ...(newRequests.length > 0 ? { newRequests } : {}),
      ...(switchedCandidate ? { switchedCandidate } : {}),
    };
    const quiet = !effect.domChanged && !effect.urlChanged && newRequests.length === 0;
    return {
      clicked: String(args.ref ?? args.selector ?? args.mark ?? args.what ?? (args.row ? `row: ${args.row}` : "target")),
      effect,
      ...(quiet ? { effectHint: "点击后未观察到任何 DOM/URL/网络变化,可能未生效(被遮挡/事件被吞/前置条件未满足);建议 browser_snapshot 核实或换目标" } : {}),
      ...(await pageIdentity(page)),
    };
  }

  return {
    clicked: String(args.ref ?? args.selector ?? args.mark ?? args.what ?? (args.row ? `row: ${args.row}` : "target")),
    ...(await pageIdentity(page)),
  };
}

export async function typeTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const target = await targetLocator(page, args);
  const text = String(args.text ?? "");
  const isHuman =
    args.humanize === true ||
    (args.humanize === undefined &&
      (config.humanize === true || (config.humanize === "auto" && isBotSensitiveUrl(page.url()))));

  if (args.editor === true) {
    const selector = String(args.ref ?? args.selector ?? "");
    const handled = await fillEditorHelper(page, selector, text);
    if (handled) {
      return {
        typed: true,
        editor: true,
        selector,
        ...(await pageIdentity(page)),
      };
    }
  }

  if (args.clear === true) {
    if (isHuman) {
      await target.fill("");
      await humanType(page, text, { speed: config.humanizeSpeed });
    } else {
      await target.fill(text, { timeout: args.timeoutMs ?? config.timeoutMs });
    }
  } else {
    try {
      await target.click({ timeout: Math.min(args.timeoutMs ?? config.timeoutMs, 5_000) });
    } catch {
      await target.click({ timeout: 2_000, force: true }).catch(() => {});
    }
    if (isHuman) {
      await humanType(page, text, { speed: config.humanizeSpeed });
    } else {
      await page.keyboard.type(text, { delay: args.delayMs ?? 0 });
    }
  }
  if (args.submit === true) await page.keyboard.press("Enter");
  return {
    typed: true,
    selector: String(args.ref ?? args.selector),
    submit: args.submit === true,
    ...(await pageIdentity(page)),
  };
}

export async function pressTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const key = String(args.key);
  let warning: string | undefined;

  // Escape 保护逻辑：当用户未指定具体 selector/ref 全局按 Escape 时，
  // 检查是否可能误关带有 closeOnEsc 的 Modal/Dialog
  if (key === "Escape" && args.selector === undefined && args.ref === undefined) {
    const checkState = await page
      .evaluate(() => {
        const dialogSelector =
          "[role='dialog']:not([aria-hidden='true']), [role='alertdialog']:not([aria-hidden='true']), [aria-modal='true']:not([aria-hidden='true']), dialog[open]";
        const dropdownSelector =
          "[role='listbox']:not([aria-hidden='true']), [role='combobox'][aria-expanded='true'], [aria-expanded='true']";
        const hasModal = Boolean(document.querySelector(dialogSelector));
        const hasOpenDropdown = Boolean(document.querySelector(dropdownSelector));
        return { hasModal, hasOpenDropdown };
      })
      .catch(() => ({ hasModal: false, hasOpenDropdown: false }));

    if (checkState.hasModal) {
      if (checkState.hasOpenDropdown) {
        // 如果页面上有还展开着的下拉浮层，优先通过失焦收起下拉，
        // 避免全局 Escape 冒泡给 Modal 的 document 监听导致整单关闭！
        await page
          .evaluate(() => {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
          })
          .catch(() => {});
        warning =
          "检测到活动弹窗且存在展开的下拉浮层。已优先收起浮层并阻止 Escape 事件冒泡关闭整个弹窗。";
      } else {
        warning =
          "检测到页面存在活动弹窗 [modal: closeOnEsc]，按全局 Escape 可能导致弹窗及其表单被关闭。若需关闭指定元素请传 selector/ref。";
      }
    }
  }

  if (args.selector !== undefined || args.ref !== undefined || (typeof args.what === "string" && args.what.trim() !== "")) {
    const target = await targetLocator(page, args);
    await target.press(key, {
      timeout: args.timeoutMs ?? config.timeoutMs,
    });
  } else {
    await page.keyboard.press(key);
  }
  return {
    pressed: key,
    ...(warning ? { warning } : {}),
    ...(await pageIdentity(page)),
  };
}




/**
 * 下拉选择原语:委托给 UI 组件库下拉适配器(Native / AntDesign / ElementPlus / GenericARIA)。
 * 各组件库特异性的展开机制、虚拟列表穿透与 0 宽度读屏傀儡节点过滤完全隔离在适配器中。
 */
export async function selectTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const target = await targetLocator(page, args);
  const label = String(args.ref ?? args.selector);
  const want = String(args.option ?? "");
  if (!want) throw new Error("select 需要 option(选项文本)");
  const exact = args.exact === true;
  const timeout = args.timeoutMs ?? config.timeoutMs;

  const result = await executeUniversalSelect({
    page,
    target,
    label,
    want,
    exact,
    timeout,
    clear: args.clear === true,
  });

  return { selected: result.selected, selector: label, ...(await pageIdentity(page)) };
}

export async function evalTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const { script, unwrapped } = unwrapDoubleEncodedScript(String(args.script ?? ""));
  // 表达式优先;含语句(换行/分号/return)时包成 async IIFE。
  const wrapped = /[\n;]|^\s*return\b/.test(script)
    ? `(async () => {\n${script}\n})()`
    : `(${script})`;
  const raw = await page.evaluate(wrapped);
  // 净化成 lossless JSON:去掉原型链/函数/DOM 引用,无法序列化的降级为字符串。
  let result: unknown;
  try {
    result = JSON.parse(JSON.stringify(raw ?? null));
  } catch {
    result = raw === undefined ? null : String(raw);
  }
  return { result, ...(unwrapped ? { scriptUnwrapped: true } : {}) };
}

export async function downloadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  let recentDownloads = downloadsOf(currentProfile);
  // wait:true 时以当前下载数为基线,轮询等待新下载出现,消除 browser_wait 盲等。
  if (args.wait === true) {
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 30_000) || 30_000, 1_000), 120_000);
    const baseline = recentDownloads.length;
    const deadline = Date.now() + timeoutMs;
    while (recentDownloads.length <= baseline && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      recentDownloads = downloadsOf(currentProfile);
    }
    if (recentDownloads.length <= baseline) {
      throw new Error(
        `等待下载超时(${timeoutMs}ms): 未检测到新下载触发事件。可能原因: 1) 前端未成功触发下载接口（可调用 browser_network 查询是否有导出请求及 4xx/5xx）；2) 后端文件生成耗时较长（可传更大的 timeoutMs 参数重试，如 { wait: true, timeoutMs: 60000 }）。`,
      );
    }
  }
  if (recentDownloads.length === 0) {
    throw new Error("no recent downloads. Trigger a download in the page first (e.g. browser_click on a download link).");
  }
  const index = args.index !== undefined ? Number(args.index) : recentDownloads.length - 1;
  const entry = recentDownloads[index];
  if (entry === undefined) throw new Error(`no download at index ${index}`);
  const cwd = workspaceBaseDir(config, exec);
  const downloadDir = config.downloadDir ?? ".dsh-browser/downloads";
  const dir = isAbsolute(downloadDir) ? downloadDir : resolve(cwd, downloadDir);
  mkdirSync(dir, { recursive: true });
  const safe = String(entry.suggestedFilename || `download-${Date.now()}`).replace(/[\\/:*?"<>|]/g, "_");
  const filePath = join(dir, safe);
  if (!filePath.startsWith(resolve(dir))) throw new Error(`download path escapes directory: ${filePath}`);
  await entry.download.saveAs(filePath);
  return {
    path: filePath,
    filename: safe,
    url: entry.download.url() ?? "",
    bytes: statSync(filePath).size,
  };
}

export async function uploadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  const cwd = workspaceBaseDir(config, exec);
  const filePath = isAbsolute(args.path) ? String(args.path) : resolve(cwd, String(args.path));
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    throw new Error(`file not found: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  const resolvedPath = resolve(filePath);
  await page.setInputFiles(String(args.selector), resolvedPath, {
    timeout: args.timeoutMs ?? config.timeoutMs,
  });
  return {
    uploaded: filePath,
    bytes: stat.size,
    ...(await pageIdentity(page)),
  };
}

export async function cookiesTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const context = page.context();
  const action = args.action ?? "list";
  if (action === "list") {
    const cookies = await context.cookies(args.url ?? page.url());
    return {
      cookies: cookies.map((c) => ({
        name: c.name,
        value: args.showValues === true ? c.value : "(hidden — set showValues=true to reveal)",
        domain: c.domain,
        path: c.path,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
        expires: c.expires,
      })),
    };
  }
  if (action === "set") {
    if (!args.name || args.value === undefined) throw new Error("set requires name and value");
    await context.addCookies([
      { name: String(args.name), value: String(args.value), url: args.url ?? page.url() },
    ]);
    return { set: true, name: String(args.name), url: args.url ?? page.url() };
  }
  if (action === "clear") {
    await context.clearCookies();
    return { cleared: true };
  }
  throw new Error(`unknown cookies action: ${action}`);
}

export async function formTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  let fields = args.fields ?? [];
  if (!Array.isArray(fields) || fields.length === 0) {
    // 回放已保存的表单
    if (typeof args.from === "string" && savedForms.has(args.from)) {
      fields = savedForms.get(args.from);
    } else {
      throw new Error("fields must be a non-empty array (or pass from=<saved form name>)");
    }
  }
  const filled = [];
  for (const field of fields) {
    const value = String(field.value ?? "");
    if (field.selector) {
      await page.fill(String(field.selector), value, { timeout: args.timeoutMs ?? config.timeoutMs });
      filled.push({ selector: field.selector });
    } else if (field.label) {
      await page.getByLabel(String(field.label), { exact: true }).fill(value);
      filled.push({ label: field.label });
    } else {
      throw new Error("each field needs a selector or a label");
    }
  }
  setLastFormFields(fields.map((f: FormField) => ({ ...f })));
  if (args.submit === true) await page.keyboard.press("Enter");
  return {
    filled,
    submit: args.submit === true,
    ...(await pageIdentity(page)),
  };
}

export async function formSaveTool(args: Record<string, any>) {
  let fields: FormField[] = args.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    if (lastFormFields.length === 0) {
      throw new Error("no fields given and no previous browser_form to remember");
    }
    fields = lastFormFields;
  }
  const name = String(args.name ?? "");
  if (!name) throw new Error("name is required");
  savedForms.set(name, fields.map((f: FormField) => ({ ...f })));
  return { saved: name, fields: fields.length };
}

export async function formsTool(args: Record<string, any>) {
  const action = args.action ?? "list";
  if (action === "list") {
    return {
      forms: [...savedForms.entries()].map(([name, fields]) => ({
        name,
        fields: fields.length,
        preview: fields
          .slice(0, 3)
          .map((f: FormField) => f.selector ?? f.label ?? "?")
          .join(", "),
      })),
    };
  }
  if (action === "delete") {
    if (!args.name) throw new Error("name is required");
    const existed = savedForms.delete(String(args.name));
    return { deleted: existed, name: String(args.name) };
  }
  throw new Error(`unknown forms action: ${action}`);
}

/**
 * 智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层
 */
export async function formFillTool(
  config: BrowserConfig,
  args: Record<string, any>,
): Promise<FormFillResult> {
  const fields = args.fields;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    throw new Error("缺少 fields 参数: 需提供包含表单键值对的对象");
  }

  const page = await getPage(config);
  const scope = typeof args.scope === "string" && args.scope ? args.scope : undefined;
  const filled: string[] = [];
  const skipped: string[] = [];
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    try {
      const res = await primitives.fillFormFieldHelper(page, { key, value }, scope);
      if (res.handled) {
        filled.push(key);
        // 轻量稳态等待，保证联动校验和级联渲染平稳完成
        await waitForDOMQuiescence(page, { quietMs: 60, maxTimeoutMs: 1500 }).catch(() => {});
      } else {
        skipped.push(key);
        if (res.error) errors[key] = res.error;
      }
    } catch (e: any) {
      skipped.push(key);
      errors[key] = e.message || String(e);
    }
  }

  let submitted: boolean | undefined = undefined;
  if (args.submitButton) {
    try {
      const submitTarget = typeof args.submitButton === "string" ? args.submitButton : "提交";
      let btnLocator: Locator;
      try {
        const resolved = await resolveTargetLocator(page, { selector: submitTarget });
        if ((await resolved.locator.count()) > 0) {
          btnLocator = resolved.locator;
        } else {
          btnLocator = page.getByRole("button", { name: submitTarget }).first();
        }
      } catch {
        btnLocator = page.getByRole("button", { name: submitTarget }).first();
      }

      await btnLocator.click({ timeout: args.timeoutMs ?? 5000 });
      submitted = true;
      await waitForDOMQuiescence(page, { quietMs: 80, maxTimeoutMs: 2000 }).catch(() => {});
    } catch (e: any) {
      submitted = false;
      errors["__submit__"] = `提交按钮点击失败: ${e.message}`;
    }
  }

  return {
    filled,
    skipped,
    errors,
    ...(submitted !== undefined ? { submitted } : {}),
  };
}

export async function transferTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const selector = String(args.selector ?? args.ref ?? "[class*='transfer']");
  const direction = (args.direction === "left" ? "right-to-left" : "left-to-right") as "left-to-right" | "right-to-left";
  const items = Array.isArray(args.items) ? args.items.map(String) : [];

  const handled = await transferItemsHelper(page, selector, items, direction);

  return {
    transferred: handled,
    direction: args.direction === "left" ? "left" : "right",
    items,
    ...(await pageIdentity(page)),
  };
}

export async function dragTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const source = String(args.source ?? "");
  const target = String(args.target ?? "");
  if (!source || !target) {
    throw new Error("drag 需要 source 与 target 选择器");
  }

  const handled = await dragAndDropHelper(page, source, target);

  return {
    dragged: handled,
    source,
    target,
    ...(await pageIdentity(page)),
  };
}
