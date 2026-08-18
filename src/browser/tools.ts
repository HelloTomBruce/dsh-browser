// dsh-browser · 浏览器 — 工具实现(22 个 browser_* 函数)
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import type { Page } from "playwright-core";
import type { ToolRunContext } from "../lib/types.js";
import type { BrowserConfig, FormField } from "./types.js";
import {
  profileConfig, getProfileState, downloadsOf, launchProfile, newPage,
  getPage, activePage, tabList, closeBrowser, pageIdentity, stateOf,
  currentProfile, savedForms, lastFormFields, profileStates, setLastFormFields, setCurrentProfile,
  noteScreenshotDir, cleanupScreenshots,
  networkEntries, clearNetwork, savedRecordings, startRecording, stopRecording,
  testLogOf, clearTestLog, isRecording, type TestCall,
} from "./session.js";
import { saveRecordingFile, listRecordings, deleteRecording } from "./recordings.js";
import { workspaceCwd } from "../lib/tools.js";

export async function openTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  await page.goto(String(args.url), {
    waitUntil: args.waitUntil ?? "domcontentloaded",
    timeout: args.timeoutMs ?? config.timeoutMs,
  });
  return {
    url: page.url(),
    title: await page.title(),
    status: "ok",
  };
}

export async function snapshotTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const maxText = args.maxTextChars ?? config.maxTextChars;
  const maxLinks = args.maxLinks ?? config.maxLinks;
  const data = await page.evaluate(
    ([maxT, maxL]) => {
      const text = document.body ? document.body.innerText : "";
      const links = Array.from(document.querySelectorAll("a"))
        .slice(0, maxL)
        .map((a) => ({
          text: (a.innerText || a.textContent || "").trim().slice(0, 200),
          href: a.href,
        }));
      const inputs = document.querySelectorAll("input, textarea, select").length;
      return { text: text.slice(0, maxT), truncated: text.length > maxT, links, inputs };
    },
    [maxText, maxLinks],
  );
  return {
    url: page.url(),
    title: await page.title(),
    ...data,
  };
}

export async function clickTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const selector = String(args.selector);
  await page.click(selector, { timeout: args.timeoutMs ?? config.timeoutMs });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  return {
    clicked: selector,
    ...(await pageIdentity(page)),
  };
}

export async function typeTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const selector = String(args.selector);
  const text = String(args.text ?? "");
  if (args.clear === true) {
    await page.fill(selector, text, { timeout: args.timeoutMs ?? config.timeoutMs });
  } else {
    await page.click(selector, { timeout: args.timeoutMs ?? config.timeoutMs });
    await page.keyboard.type(text, { delay: args.delayMs ?? 0 });
  }
  if (args.submit === true) await page.keyboard.press("Enter");
  return {
    typed: true,
    selector,
    submit: args.submit === true,
    ...(await pageIdentity(page)),
  };
}

export async function pressTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const key = String(args.key);
  if (args.selector) {
    await page.press(String(args.selector), key, {
      timeout: args.timeoutMs ?? config.timeoutMs,
    });
  } else {
    await page.keyboard.press(key);
  }
  return { pressed: key, ...(await pageIdentity(page)) };
}

export async function evalTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const script = String(args.script ?? "");
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
  return { result };
}

export async function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  const cwd = workspaceCwd(exec);
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const dir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
  mkdirSync(dir, { recursive: true });
  const safeName = String(args.name ?? `shot-${Date.now()}`).replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
  const fileName = safeName.endsWith(".png") ? safeName : `${safeName}.png`;
  const filePath = join(dir, fileName);
  const buffer = await page.screenshot({ type: "png" });
  writeFileSync(filePath, buffer);
  // 懒清理:按保留天数/数量修剪目录,并把目录记下供定时清扫复用。
  noteScreenshotDir(dir);
  cleanupScreenshots(dir, {
    maxAgeDays: config.screenshotMaxAgeDays,
    maxCount: config.screenshotMaxCount,
  });
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  return {
    path: filePath,
    bytes: buffer.length,
    width: viewport.width,
    height: viewport.height,
  };
}

export async function waitTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const ms = Math.max(0, Math.min(Number(args.ms ?? 1000) || 0, 60000));
  await page.waitForTimeout(ms);
  return { waitedMs: ms, ...(await pageIdentity(page)) };
}

export async function backTool(config: BrowserConfig) {
  const page = await getPage(config);
  await page.goBack().catch(() => {});
  return { ...(await pageIdentity(page)) };
}

export async function reloadTool(config: BrowserConfig) {
  const page = await getPage(config);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  return { ...(await pageIdentity(page)) };
}

export async function statusTool() {
  const page = activePage();
  const state = stateOf();
  const profiles = [];
  for (const [name, s] of profileStates) {
    profiles.push({
      name,
      open: s.browser !== null || s.context !== null,
      tabs: s.pages.size,
      channel: s.channel ?? "",
      persistent: s.persistent,
    });
  }
  if (page === null) {
    return { open: false, profile: currentProfile, channel: state.channel ?? "", tabs: 0, profiles };
  }
  return {
    open: true,
    profile: currentProfile,
    channel: state.channel ?? "",
    tabs: state.pages.size,
    profiles,
    ...(await pageIdentity(page)),
  };
}

export async function tabsTool(config: BrowserConfig, args: Record<string, any>) {
  const action = args.action ?? "list";
  const state = stateOf();
  if (state.browser === null && state.context === null && action !== "list") await launchProfile(currentProfile, config);
  if (state.browser === null && state.context === null) return { action, tabs: [], activeId: -1 };
  switch (action) {
    case "list": {
      return { action, tabs: await tabList(), activeId: state.activeId ?? -1 };
    }
    case "new": {
      const page = await newPage(config);
      const id = state.counter++;
      state.pages.set(id, page);
      state.activeId = id;
      if (args.url) {
        await page.goto(String(args.url), {
          waitUntil: args.waitUntil ?? "domcontentloaded",
          timeout: args.timeoutMs ?? config.timeoutMs,
        });
      }
      return { action, tab: { id, url: page.url(), title: await page.title() }, tabs: await tabList(), activeId: state.activeId };
    }
    case "switch": {
      const id = resolveTabId(args);
      if (!state.pages.has(id)) throw new Error(`no tab with id ${id}`);
      state.activeId = id;
      return { action, activeId: state.activeId, tabs: await tabList() };
    }
    case "close": {
      const id = resolveTabId(args);
      const page = state.pages.get(id);
      if (page === undefined) throw new Error(`no tab with id ${id}`);
      await page.close().catch(() => {});
      state.pages.delete(id);
      if (state.activeId === id) {
        const next = state.pages.keys().next().value;
        state.activeId = next === undefined ? null : next;
      }
      return { action, activeId: state.activeId ?? -1, tabs: await tabList() };
    }
    default:
      throw new Error(`unknown tabs action: ${action}`);
  }
}

export function resolveTabId(args: Record<string, any>): number {
  const state = stateOf();
  if (args.id !== undefined) return Number(args.id);
  if (args.index !== undefined) {
    const ids = [...state.pages.keys()];
    const idx = Number(args.index);
    if (idx < 0 || idx >= ids.length) throw new Error(`tab index ${idx} out of range`);
    return ids[idx];
  }
  if (state.activeId !== null) return state.activeId;
  throw new Error("no tab id/index given and no active tab");
}

export async function downloadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const recentDownloads = downloadsOf(currentProfile);
  if (recentDownloads.length === 0) {
    throw new Error("no recent downloads. Trigger a download in the page first (e.g. browser_click on a download link).");
  }
  const index = args.index !== undefined ? Number(args.index) : recentDownloads.length - 1;
  const entry = recentDownloads[index];
  if (entry === undefined) throw new Error(`no download at index ${index}`);
  const cwd = workspaceCwd(exec);
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
  const cwd = workspaceCwd(exec);
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

export async function profileTool(config: BrowserConfig, args: Record<string, any>) {
  const action = args.action ?? "list";
  const available = Object.keys(config.profiles ?? {});
  // 与 outputSchema 保持一致:profiles 永远是对象数组,不随动作变化。
  const describe = (name: string) => {
    const state = getProfileState(name);
    return {
      name,
      open: state.browser !== null || state.context !== null,
      tabs: state.pages.size,
      persistent: state.persistent,
      userDataDir: profileConfig(config, name).userDataDir ?? "",
    };
  };
  if (action === "list") {
    return { current: currentProfile, profiles: available.map(describe) };
  }
  if (action === "use") {
    const name = String(args.name ?? "");
    if (name !== "default" && !available.includes(name)) {
      throw new Error(`unknown profile: ${name} (available: ${["default", ...available].join(", ")})`);
    }
    setCurrentProfile(name);
    return { current: currentProfile, profiles: available.map(describe) };
  }
  throw new Error(`unknown profile action: ${action}`);
}

export async function elementsTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const max = Math.min(Math.max(Number(args.max ?? 60) || 60, 1), 200);
  const elements = await page.evaluate((maxN: number) => {
    const out: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const nodes = Array.from(
      document.querySelectorAll("input, textarea, select, button, a[href]"),
    ) as HTMLElement[];
    for (const el of nodes) {
      if (out.length >= maxN) break;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const info = {
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? "",
        name: (el as HTMLInputElement).name ?? "",
        id: el.id ?? "",
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        text: (el.innerText || el.textContent || "").trim().slice(0, 80),
        href: (el as HTMLAnchorElement).href ?? "",
        selector:
          el.id !== ""
            ? `#${CSS.escape(el.id)}`
            : (el as HTMLInputElement).name !== ""
              ? `${el.tagName.toLowerCase()}[name="${(el as HTMLInputElement).name}"]`
              : "",
      };
      const key = `${info.tag}|${info.name}|${info.id}|${info.placeholder}|${info.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(info);
    }
    return out;
  }, max);
  return { count: elements.length, elements };
}

export async function closeTool() {
  await closeBrowser();
  return { closed: true };
}

/**
 * 条件检查引擎(测试原语共用)。
 *
 * cond 支持四类(每类内部互斥,取第一个存在的字段):
 *   { selector: "#btn", state: "visible|hidden|attached|detached" }  元素状态(默认 visible)
 *   { url: "正则字符串" }                                            当前 URL 匹配
 *   { text: "子串" }                                                  body 可见文本包含
 *   { count: { selector, op: "eq|gt|gte|lt|lte", value: n } }         元素数量比较
 *   { eval: "JS 表达式" }                                            表达式求值 truthy
 */
export type TestCondition = Record<string, any>;

/** 单次检查:返回 { ok, detail }。不抛错,失败时 detail 给出原因。 */
export async function checkOnce(page: Page, cond: TestCondition): Promise<{ ok: boolean; detail?: string }> {
  if (cond.selector !== undefined) {
    const locator = page.locator(String(cond.selector));
    const state = String(cond.state ?? "visible");
    try {
      await locator.waitFor({ state: state as any, timeout: 120 });
      return { ok: true };
    } catch {
      return { ok: false, detail: `元素 ${cond.selector} 未达到 ${state}` };
    }
  }
  if (cond.url !== undefined) {
    const url = page.url();
    try {
      return new RegExp(String(cond.url)).test(url) ? { ok: true } : { ok: false, detail: `URL 不匹配 ${cond.url}(当前 ${url})` };
    } catch {
      return { ok: false, detail: `非法正则: ${cond.url}` };
    }
  }
  if (cond.text !== undefined) {
    const needle = String(cond.text);
    try {
      const has = await page.evaluate((s) => (document.body ? document.body.innerText : "").includes(s), needle);
      return has ? { ok: true } : { ok: false, detail: `页面文本不含 "${needle}"` };
    } catch (e) {
      return { ok: false, detail: `文本检查失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (cond.count !== undefined && typeof cond.count === "object") {
    const c = cond.count as { selector: string; op?: string; value: number };
    try {
      const actual = await page.locator(String(c.selector)).count();
      const want = Number(c.value);
      const op = c.op ?? "eq";
      const ok =
        op === "eq" ? actual === want
        : op === "gt" ? actual > want
        : op === "gte" ? actual >= want
        : op === "lt" ? actual < want
        : op === "lte" ? actual <= want
        : false;
      return ok ? { ok: true } : { ok: false, detail: `${c.selector} 数量 ${actual} 不满足 ${op} ${want}` };
    } catch (e) {
      return { ok: false, detail: `数量检查失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (cond.eval !== undefined) {
    try {
      const value = await page.evaluate(String(cond.eval));
      return value ? { ok: true } : { ok: false, detail: `eval 条件为假: ${cond.eval}` };
    } catch (e) {
      return { ok: false, detail: `eval 执行失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  throw new Error("条件无效: 需要 selector/url/text/count/eval 之一");
}

/** 轮询等待条件成立(intervalMs 步进),返回最后一次检查结果。 */
export async function pollCondition(
  page: Page,
  cond: TestCondition,
  timeoutMs: number,
  intervalMs = 500,
): Promise<{ ok: boolean; detail?: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { ok: boolean; detail?: string } = { ok: false, detail: "超时" };
  while (Date.now() < deadline) {
    try {
      last = await checkOnce(page, cond);
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

/** 通用显式等待:等待条件成立,超时抛错。 */
export async function waitForTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 120_000);
  const intervalMs = Math.max(Number(args.intervalMs ?? 500) || 500, 100);
  const result = await pollCondition(page, args.condition, timeoutMs, intervalMs);
  if (!result.ok) {
    throw new Error(`等待条件超时(${timeoutMs}ms): ${result.detail ?? "条件未满足"}`);
  }
  return { met: true, ...(await pageIdentity(page)) };
}

/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
 * successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
 * 超时返回 loggedIn:false(不抛错)。
 */
export async function waitForLoginTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const startUrl = page.url();
  let condition: TestCondition;
  if (args.successSelector) {
    condition = { selector: String(args.successSelector), state: "visible" };
  } else if (args.successUrl) {
    condition = { url: String(args.successUrl) };
  } else {
    condition = {
      eval: `location.href !== ${JSON.stringify(startUrl)} && location.href !== "about:blank"`,
    };
  }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 120_000) || 120_000, 5_000), 600_000);
  const result = await pollCondition(page, condition, timeoutMs, 2_000);
  return { loggedIn: result.ok, ...(await pageIdentity(page)) };
}

/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。 */
export async function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 5_000) || 5_000, 100), 60_000);
  const intervalMs = Math.max(Number(args.intervalMs ?? 300) || 300, 50);
  const result = await pollCondition(page, args.condition, timeoutMs, intervalMs);
  if (result.ok) {
    return { passed: true, ...(await pageIdentity(page)) };
  }
  // 失败:自动截图存证据目录,抛错携带原因与路径。
  const cwd = workspaceCwd(exec);
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const dir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `assert-fail-${Date.now()}.png`);
  try {
    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(filePath, buffer);
    noteScreenshotDir(dir);
    cleanupScreenshots(dir, {
      maxAgeDays: config.screenshotMaxAgeDays,
      maxCount: config.screenshotMaxCount,
    });
  } catch {
    /* 截图失败不阻断错误上报 */
  }
  throw new Error(`断言失败: ${result.detail ?? "条件未满足"}; 失败截图: ${filePath}`);
}

function matchNetwork(entry: { url: string; method: string; status?: number; ok?: boolean; failed?: boolean }, f: Record<string, any>): boolean {
  if (f.urlSubstr && !entry.url.includes(String(f.urlSubstr))) return false;
  if (f.method && entry.method.toUpperCase() !== String(f.method).toUpperCase()) return false;
  if (f.status !== undefined && Number(f.status) !== entry.status) return false;
  if (f.failedOnly === true && !entry.failed && (entry.status === undefined || entry.status < 400)) return false;
  return true;
}

/** 网络记录查询:list / failed / wait / clear。 */
export async function networkTool(args: Record<string, any>) {
  const action = args.action ?? "list";
  const entries = networkEntries(currentProfile);
  if (action === "clear") {
    clearNetwork(currentProfile);
    return { cleared: true, entries: 0 };
  }
  if (action === "wait") {
    if (!args.url) throw new Error("wait 需要 url(正则字符串)");
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 60_000);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = [...entries]
        .reverse()
        .find((e) => {
          if (!new RegExp(String(args.url)).test(e.url)) return false;
          if (args.status !== undefined && Number(args.status) !== e.status) return false;
          return true;
        });
      if (hit !== undefined) return { matched: hit, waitMs: Date.now() + timeoutMs - deadline - (Date.now() + timeoutMs - deadline) + 0 };
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`等待接口超时(${timeoutMs}ms): ${args.url}`);
  }
  const filter = action === "failed" ? { failedOnly: true } : args;
  const list = [...entries].reverse().filter((e) => matchNetwork(e, filter)).slice(0, Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200));
  if (action === "failed") return { failed: list };
  if (action === "list") return { entries: list };
  throw new Error(`unknown network action: ${action}`);
}

/** 录制管理:start / stop / save / list / delete。 */
export async function recordTool(args: Record<string, any>) {
  const action = args.action ?? "start";
  if (action === "start") {
    startRecording();
    return { recording: true, hint: "后续浏览器工具调用将记录;用 browser_record stop 结束,再 save <name> 保存" };
  }
  if (action === "stop") {
    if (!isRecording()) throw new Error("当前没有录制");
    const steps = stopRecording();
    return { recording: false, steps: steps.length };
  }
  if (action === "save") {
    if (isRecording()) throw new Error("录制未结束:先 browser_record stop");
    const name = String(args.name ?? "");
    if (!name) throw new Error("save 需要 name");
    const steps = testLogOf().reverse().slice(-100).map((c) => ({ tool: c.tool, args: c.args ?? {} }));
    savedRecordings.set(name, { steps, savedAt: Date.now() });
    const file = saveRecordingFile(name, steps);
    return { saved: name, steps: steps.length, file, hint: "已持久化到磁盘,重启 DSH 后仍可回放" };
  }
  if (action === "list") {
    return { recordings: listRecordings() };
  }
  if (action === "delete") {
    if (!args.name) throw new Error("delete 需要 name");
    const name = String(args.name);
    const deleted = deleteRecording(name);
    return { deleted, name };
  }
  throw new Error(`unknown record action: ${action}`);
}

/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。 */
export async function runReplay(
  steps: { tool: string; args: any }[],
  impls: Record<string, (args: any) => Promise<unknown>>,
  failFast: boolean,
): Promise<{ total: number; passed: number; failed: number; stoppedAt: number | null; results: any[] }> {
  const results: any[] = [];
  let stoppedAt: number | null = null;
  let passed = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const impl = impls[step.tool];
    if (impl === undefined) {
      results.push({ index: i, tool: step.tool, ok: false, error: `未知步骤工具: ${step.tool}` });
      if (failFast) { stoppedAt = i; break; }
      continue;
    }
    try {
      await impl(step.args ?? {});
      passed++;
      results.push({ index: i, tool: step.tool, ok: true });
    } catch (e) {
      results.push({ index: i, tool: step.tool, ok: false, error: e instanceof Error ? e.message : String(e) });
      if (failFast) { stoppedAt = i; break; }
    }
  }
  return { total: steps.length, passed, failed: results.length - passed, stoppedAt, results };
}

/** 回放入口:name(已保存录制)或 steps(数组)二选一。 */
export async function replayTool(
  args: Record<string, any>,
  impls: Record<string, (args: any) => Promise<unknown>>,
) {
  let steps: { tool: string; args: any }[] = [];
  let source = "steps";
  if (typeof args.name === "string" && args.name) {
    const saved = savedRecordings.get(args.name);
    if (saved === undefined) throw new Error(`未找到录制: ${args.name}`);
    steps = saved.steps;
    source = args.name;
  } else if (Array.isArray(args.steps)) {
    steps = args.steps;
  } else {
    throw new Error("replay 需要 name(已保存录制)或 steps(步骤数组)");
  }
  if (steps.length === 0) throw new Error("步骤为空");
  const failFast = args.failFast !== false;
  const result = await runReplay(steps, impls, failFast);
  return { source, ...result, summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${result.stoppedAt !== null ? `(停在步骤 ${result.stoppedAt})` : ""}` : ""}` };
}
