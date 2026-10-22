// dsh-browser · 浏览器工具 — 页面元素交互、表单与文件处理
import { existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Locator, Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, FormField } from "../types.js";
import {
  getPage, activePage, pageRef, pageIdentity,
  savedForms, lastFormFields, setLastFormFields,
  downloadsOf, currentProfile,
} from "../session.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { withTimeout, unwrapDoubleEncodedScript, workspaceFilePath } from "./common.js";
import { executeSelectAdapter } from "../adapters/select.js";
import { extractElementLabel, getActiveDialog } from "../adapters/dom.js";
import { adapterRegistry } from "../adapters/index.js";



/**
 * 解析点击/输入目标为 Locator:selector 直译;ref 走注册表——
 * 先试快照时的 CSS 路径并校验 role/name 仍一致(防 ref 漂移误点),
 * 不一致则降级 getByRole(role, {name}),均失败报「ref 已失效」。
 */
export async function targetLocator(page: Page, args: Record<string, any>): Promise<Locator> {
  if (args.ref !== undefined && args.ref !== "") {
    const ref = String(args.ref);
    const entry = pageRef(page, ref);
    if (entry === undefined) {
      throw new Error(
        `未知 ref: ${ref}(页面导航或重新快照后旧 ref 失效;请先 browser_snapshot { mode: "aria" })`,
      );
    }
    const byPath = page.locator(entry.selector).first();
    if ((await withTimeout(byPath.count(), 3_000, "解析 ref 路径").catch(() => 0)) > 0) {
      const ok = await withTimeout(
        byPath
          .evaluate((el, { role, name, labelScript }) => {
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute("type") ?? "").toLowerCase();
          const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
          const roleOk =
            role === "" ||
            roleAttr === role ||
            (role === "link" && tag === "a") ||
            (role === "button" &&
              (tag === "button" || tag === "summary" || (tag === "input" && ["button", "submit", "reset", "image"].includes(type)))) ||
            (["textbox", "searchbox"].includes(role) && (tag === "textarea" || (tag === "input" && !["hidden", "checkbox", "radio"].includes(type)))) ||
            (role === "combobox" && tag === "select") ||
            (role === "checkbox" && tag === "input" && type === "checkbox") ||
            (role === "radio" && tag === "input" && type === "radio");
          const aria = el.getAttribute("aria-label") ?? "";
          const ph = el.getAttribute("placeholder") ?? "";
          const title = el.getAttribute("title") ?? "";
          const text = ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ");

          let labelText = "";
          try {
            const labelFn = new Function("el", "return (" + labelScript + ")(el);");
            labelText = String(labelFn(el) || "");
          } catch {
            /* ignore */
          }

          const nameOk =
            name === "" ||
            aria.includes(name) ||
            ph.includes(name) ||
            title.includes(name) ||
            text.includes(name) ||
            labelText.includes(name);
          return roleOk && nameOk;
        }, { role: entry.role, name: entry.name, labelScript: extractElementLabel.toString() }),
        3_000,
        "校验 ref 元素",
      ).catch(() => false);
      if (ok) return byPath;
    }
    // 降级:委托给 UI 适配器感知当前处于激活状态的 Modal 弹窗,优先在弹窗容器内检索,防穿透点到底层遮挡元素
    try {
      const activeDialog = getActiveDialog(page);
      if (activeDialog && typeof activeDialog.getByRole === "function") {
        const inDialog =
          entry.name !== ""
            ? activeDialog.getByRole(entry.role as any, { name: entry.name }).first()
            : activeDialog.getByRole(entry.role as any).first();
        if ((await withTimeout(inDialog.count(), 1_000, "弹窗内 role 查找").catch(() => 0)) > 0) {
          return inDialog;
        }
      }
    } catch {
      // 容错处理
    }

    // 默认降级:role + name
    const byRole =
      entry.name !== ""
        ? page.getByRole(entry.role as any, { name: entry.name }).first()
        : page.getByRole(entry.role as any).first();
    if ((await withTimeout(byRole.count(), 3_000, "解析 ref role 降级").catch(() => 0)) > 0) return byRole;
    throw new Error(
      `ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`,
    );
  }
  if (args.selector === undefined) throw new Error("需要 selector 或 ref 之一");
  return page.locator(String(args.selector)).first();
}

export async function clickTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  let target = await targetLocator(page, args);
  const label = String(args.ref ?? args.selector ?? "");

  // 1. 适配器动作前置预处理 (例如隐藏 input 点击目标提升)
  const lifted = await adapterRegistry.beforeAction({ page, config, target, action: "click", args });
  if (lifted) target = lifted;

  try {
    await target.click({ timeout: args.timeoutMs ?? config.timeoutMs, force: args.force === true });
  } catch (e) {
    // 2. 适配器动作异常自愈 (例如遮罩层拦截与动画恢复)
    const recovered = await adapterRegistry.onActionError({ page, config, target, action: "click", args }, e as Error);
    if (recovered?.handled && recovered.retryWith) {
      await (recovered.retryWith.target ?? target).click({
        timeout: recovered.retryWith.timeoutMs ?? 3000,
        force: recovered.retryWith.force ?? false,
      });
    } else {
      // 超时诊断:区分「元素没匹配到」与「匹配到但不可交互」;点击引发的导航竞态
      // (事件已派发但 promise 超时)给提示,让 agent 用 snapshot 确认实际状态。
      const msg = e instanceof Error ? e.message : String(e);
      let diag = "";
      try {
        const n = await target.count();
        if (n === 0) diag = "元素未匹配(selector 可能写错或元素未渲染)";
        else {
          const visible = await target.first().isVisible();
          diag = visible ? "元素可见但不可交互(被遮挡/禁用?);若页面刚发生跳转,点击可能实际已生效" : "元素存在但不可见";
        }
      } catch {
        diag = "元素已从页面移除(若页面刚发生跳转,点击可能实际已生效)";
      }
      throw new Error(`click 失败: ${label} — ${diag};原始错误: ${msg}`);
    }
  }

  // 3. 稳态等待（兼顾传统整页导航与 SPA 单页渲染）
  const adapter = await adapterRegistry.getActiveAdapter(page);
  await Promise.race([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    adapter.waitForQuiescence ? adapter.waitForQuiescence(page, { quietMs: 60 }) : Promise.resolve(),
  ]);

  return {
    clicked: String(args.ref ?? args.selector),
    ...(await pageIdentity(page)),
  };
}

export async function typeTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const target = await targetLocator(page, args);
  const text = String(args.text ?? "");
  if (args.clear === true) {
    await target.fill(text, { timeout: args.timeoutMs ?? config.timeoutMs });
  } else {
    try {
      await target.click({ timeout: Math.min(args.timeoutMs ?? config.timeoutMs, 5_000) });
    } catch {
      await target.click({ timeout: 2_000, force: true }).catch(() => {});
    }
    await page.keyboard.type(text, { delay: args.delayMs ?? 0 });
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
  if (args.selector !== undefined || args.ref !== undefined) {
    const target = await targetLocator(page, args);
    await target.press(key, {
      timeout: args.timeoutMs ?? config.timeoutMs,
    });
  } else {
    await page.keyboard.press(key);
  }
  return { pressed: key, ...(await pageIdentity(page)) };
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

  const result = await executeSelectAdapter({
    page,
    target,
    label,
    want,
    exact,
    timeout,
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
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 60_000);
    const baseline = recentDownloads.length;
    const deadline = Date.now() + timeoutMs;
    while (recentDownloads.length <= baseline && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      recentDownloads = downloadsOf(currentProfile);
    }
    if (recentDownloads.length <= baseline) {
      throw new Error(`等待下载超时(${timeoutMs}ms):未检测到新下载,请先在页面触发下载动作`);
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
