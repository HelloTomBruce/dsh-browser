// dsh-browser · 浏览器 — 工具实现(browser_* 函数)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Locator, Page } from "playwright-core";
import type { ToolRunContext } from "../lib/types.js";
import type { BrowserConfig, FormField, RefEntry, ReplayStep, SelectorHint } from "./types.js";
import {
  profileConfig, getProfileState, downloadsOf, launchProfile, newPage,
  getPage, activePage, tabList, closeBrowser, pageIdentity, stateOf,
  currentProfile, savedForms, lastFormFields, profileStates, setLastFormFields, setCurrentProfile,
  noteScreenshotDir, cleanupScreenshots,
  networkEntries, clearNetwork, savedRecordings, startRecording, stopRecording, lastRecordingOf,
  testLogOf, clearTestLog, isRecording, setPageRefs, pageRef, type TestCall,
} from "./session.js";
import { saveRecordingFile, listRecordings, deleteRecording, safeName as sanitizeName } from "./recordings.js";
import { serializeRows, formatFromFile, parseCsv } from "./extract.js";
import { appendRun, listRuns, getRun, latestRun, makeRunId, renderMarkdownReport, renderHtmlReport, type RunRecord } from "./reports.js";
import { workspaceBaseDir } from "../lib/tools.js";

/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
export function scaleRects(
  rects: { x: number; y: number; width: number; height: number }[],
  scale: number,
): { x: number; y: number; width: number; height: number }[] {
  return rects.map((r) => ({
    x: Math.round(r.x * scale),
    y: Math.round(r.y * scale),
    width: Math.round(r.width * scale),
    height: Math.round(r.height * scale),
  }));
}

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

/**
 * 快照文本压缩(导出供测试):
 *   - 去掉首尾空白行;
 *   - 连续空白行折叠为 1 行;
 *   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
 * 只折叠完全相同的相邻行,不重排、不删改非重复内容。
 */
export function compressText(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      blankRun++;
      if (blankRun === 1 && out.length > 0) out.push("");
      continue;
    }
    blankRun = 0;
    // 统计当前行与后续相同行的重复次数
    let dup = 0;
    while (i + dup + 1 < lines.length && lines[i + dup + 1].trim() === trimmed) dup++;
    out.push(lines[i]);
    if (dup > 0) {
      out.push(`…(重复 ${dup} 行)`);
      i += dup;
    }
  }
  // 去掉尾部空白行
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * 页内 ARIA 树构建(自包含函数,page.evaluate 序列化注入;禁止引用模块级变量)。
 * 遍历 DOM:结构角色(navigation/main/form/table/heading…)直接打印;
 * 可交互元素分配 ref=e1..eN 并附稳定 CSS 路径;无语义容器(div/span)穿透。
 * 输出形如 `- button "登录" [ref=e3]` 的缩进树,供纯文本模型定位操作目标。
 */
function buildAriaTree(maxRefs: number): {
  tree: string;
  refs: { ref: string; role: string; name: string; selector: string }[];
  truncated: boolean;
} {
  const INTERACTIVE = new Set([
    "link", "button", "textbox", "checkbox", "radio", "combobox", "listbox",
    "searchbox", "slider", "spinbutton", "switch", "tab", "menuitem", "option", "treeitem",
  ]);
  const STRUCTURAL = new Set([
    "navigation", "main", "banner", "contentinfo", "form", "search", "complementary",
    "region", "dialog", "alert", "table", "list", "heading", "toolbar", "menu", "menubar",
    "tablist", "tree", "grid",
  ]);
  const SKIP_TAGS = new Set(["script", "style", "template", "noscript", "svg", "path", "link", "meta", "br"]);

  function roleOf(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0] ?? "";
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a": return el.hasAttribute("href") ? "link" : "";
      case "button": return "button";
      case "input": {
        const t = (el.getAttribute("type") ?? "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "range") return "slider";
        if (t === "number") return "spinbutton";
        if (t === "search") return "searchbox";
        if (["button", "submit", "reset", "image"].includes(t)) return "button";
        if (["hidden", "file"].includes(t)) return "";
        return "textbox";
      }
      case "textarea": return "textbox";
      case "select": return "combobox";
      case "nav": return "navigation";
      case "main": return "main";
      case "header": return "banner";
      case "footer": return "contentinfo";
      case "form": return "form";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
      case "ul": case "ol": return "list";
      case "li": return "listitem";
      case "table": return "table";
      case "dialog": return "dialog";
      case "summary": return "button";
      default: return "";
    }
  }

  function nameOf(el: Element, role: string): string {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim().slice(0, 60);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (t) return t.slice(0, 60);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = lab?.textContent?.trim();
      if (t) return t.slice(0, 60);
    }
    if (["textbox", "searchbox", "combobox", "spinbutton"].includes(role)) {
      const ph = el.getAttribute("placeholder");
      if (ph && ph.trim()) return ph.trim().slice(0, 60);
    }
    const text = ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (text) return text.slice(0, 60);
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim().slice(0, 60);
    return "";
  }

  /** 稳定 CSS 路径:#id → [data-testid] → nth-of-type 链(≤6 层)。 */
  function cssPath(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
    if (testid) return `[data-testid="${testid.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 6) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      const idx = sameTag.indexOf(cur) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      cur = parent;
    }
    return parts.join(" > ");
  }

  function isVisible(el: Element): boolean {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  const lines: string[] = [];
  const refs: { ref: string; role: string; name: string; selector: string }[] = [];
  let truncated = false;

  function walk(el: Element, depth: number): void {
    if (truncated) return;
    if (lines.length >= 400 || depth > 10) {
      truncated = true;
      return;
    }
    const role = roleOf(el);
    if (INTERACTIVE.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const ref = refs.length < maxRefs ? `e${refs.length + 1}` : "";
      if (ref !== "") refs.push({ ref, role, name, selector: cssPath(el) });
      const expanded = el.getAttribute("aria-expanded");
      const disabled =
        (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
      lines.push(
        `${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${ref !== "" ? ` [ref=${ref}]` : ""}${expanded !== null ? ` [expanded=${expanded}]` : ""}${disabled ? " [disabled]" : ""}`,
      );
      return; // 可交互元素不再深入(按钮内 svg/span 等是噪音)
    }
    if (STRUCTURAL.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const level = role === "heading" ? ` [level=${el.tagName[1] ?? "1"}]` : "";
      lines.push(`${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${level}`);
      for (const c of Array.from(el.children)) {
        if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth + 1);
      }
      return;
    }
    // 无语义容器:穿透
    for (const c of Array.from(el.children)) {
      if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth);
    }
  }

  if (document.body) walk(document.body, 0);
  return { tree: lines.join("\n"), refs, truncated };
}

export async function snapshotTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const maxText = args.maxTextChars ?? config.maxTextChars;
  // ARIA 模式:可访问性树 + ref 引用,定位操作用(读正文仍用默认 text 模式)。
  if (args.mode === "aria") {
    const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
    const data = await page.evaluate(buildAriaTree, maxRefs);
    const map = new Map<string, RefEntry>(
      data.refs.map((r) => [r.ref, { role: r.role, name: r.name, selector: r.selector }]),
    );
    setPageRefs(page, map); // 整表替换,旧 ref 即刻失效
    return {
      url: page.url(),
      title: await page.title(),
      tree: data.tree.slice(0, maxText),
      truncated: data.truncated || data.tree.length > maxText,
      refs: data.refs.length,
    };
  }
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
      return { text, links, inputs };
    },
    [maxText, maxLinks],
  );
  const compressed = compressText(data.text);
  return {
    url: page.url(),
    title: await page.title(),
    text: compressed.slice(0, maxText),
    truncated: compressed.length > maxText,
    links: data.links,
    inputs: data.inputs,
  };
}

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
    if ((await byPath.count().catch(() => 0)) > 0) {
      const ok = await byPath
        .evaluate((el, want) => {
          const tag = el.tagName.toLowerCase();
          const type = (el.getAttribute("type") ?? "").toLowerCase();
          const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
          const roleOk =
            want.role === "" ||
            roleAttr === want.role ||
            (want.role === "link" && tag === "a") ||
            (want.role === "button" &&
              (tag === "button" || tag === "summary" || (tag === "input" && ["button", "submit", "reset", "image"].includes(type)))) ||
            (["textbox", "searchbox"].includes(want.role) && (tag === "textarea" || (tag === "input" && !["hidden", "checkbox", "radio"].includes(type)))) ||
            (want.role === "combobox" && tag === "select") ||
            (want.role === "checkbox" && tag === "input" && type === "checkbox") ||
            (want.role === "radio" && tag === "input" && type === "radio");
          const aria = el.getAttribute("aria-label") ?? "";
          const ph = el.getAttribute("placeholder") ?? "";
          const text = ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ");
          const nameOk =
            want.name === "" || aria.includes(want.name) || ph.includes(want.name) || text.includes(want.name);
          return roleOk && nameOk;
        }, { role: entry.role, name: entry.name })
        .catch(() => false);
      if (ok) return byPath;
    }
    // 降级:role + name
    const byRole =
      entry.name !== ""
        ? page.getByRole(entry.role as any, { name: entry.name }).first()
        : page.getByRole(entry.role as any).first();
    if ((await byRole.count().catch(() => 0)) > 0) return byRole;
    throw new Error(
      `ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`,
    );
  }
  if (args.selector === undefined) throw new Error("需要 selector 或 ref 之一");
  return page.locator(String(args.selector)).first();
}

export async function clickTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const target = await targetLocator(page, args);
  await target.click({ timeout: args.timeoutMs ?? config.timeoutMs });
  await page.waitForLoadState("domcontentloaded").catch(() => {});
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
    await target.click({ timeout: args.timeoutMs ?? config.timeoutMs });
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

/** 组件库下拉框的可见选项选择器并集(antd / element-plus / 通用 ARIA listbox)。 */
const DROPDOWN_OPTION_SELECTOR = [
  ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
  ".el-select-dropdown__item",
  "[role='listbox'] [role='option']",
].join(", ");

/**
 * 下拉选择原语:原生 <select> 走 selectOption;组件库下拉(antd/element/listbox)
 * 走「点击触发框 → 等待可见选项 → 按文本点击」。找不到选项时抛出错误并附当前可见
 * 选项清单,agent 可直接据此修正,无需再手写 eval 探查。
 */
export async function selectTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const target = await targetLocator(page, args);
  const label = String(args.ref ?? args.selector);
  const want = String(args.option ?? "");
  if (!want) throw new Error("select 需要 option(选项文本)");
  const exact = args.exact === true;
  const timeout = args.timeoutMs ?? config.timeoutMs;

  // 1) 原生 <select>
  const tag = await target
    .evaluate((el) => el.tagName.toLowerCase())
    .catch(() => "");
  if (tag === "select") {
    try {
      await target.selectOption({ label: want }, { timeout });
      return { selected: want, selector: label, ...(await pageIdentity(page)) };
    } catch {
      const options = await target.locator("option").allTextContents();
      throw new Error(`原生下拉无选项 "${want}";可用选项: ${options.map((t) => t.trim()).join(" / ")}`);
    }
  }

  // 2) 组件库下拉:点击触发框展开
  await target.click({ timeout });
  const options = page.locator(DROPDOWN_OPTION_SELECTOR);
  await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => {});
  const texts = (await options.allTextContents()).map((t) => t.trim()).filter(Boolean);
  if (texts.length === 0) {
    throw new Error(`点击 ${label} 后未出现下拉选项(非原生 select,也不是已知的组件库下拉)`);
  }
  const index = texts.findIndex((t) => (exact ? t === want : t.includes(want)));
  if (index === -1) {
    await page.keyboard.press("Escape").catch(() => {}); // 收起下拉,保持现场干净
    throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
  }
  await options.nth(index).click();
  return { selected: texts[index], selector: label, ...(await pageIdentity(page)) };
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
  const cwd = workspaceBaseDir(config, exec);
  // baseline 模式:写入基线目录(.dsh-browser/baselines),不受截图清理策略约束。
  if (typeof args.baseline === "string" && args.baseline !== "") {
    const baselineName = sanitizeName(args.baseline);
    const baselineDir = config.baselineDir ?? ".dsh-browser/baselines";
    const dir = isAbsolute(baselineDir) ? baselineDir : resolve(cwd, baselineDir);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${baselineName}.png`);
    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(filePath, buffer);
    const size = pngSize(buffer);
    return {
      path: filePath,
      bytes: buffer.length,
      width: size.width,
      height: size.height,
      baseline: baselineName,
    };
  }
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
  const data = await page.evaluate(
    ([maxN, optionSelector]) => {
      /** 提取元素的关联 label:aria-label → label[for] → form-item 标签(antd/element)。 */
      function labelOf(el: HTMLElement): string {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        if (el.id) {
          const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          const text = forLabel?.textContent?.trim();
          if (text) return text;
        }
        const antItem = el.closest(".ant-form-item");
        const antLabel = antItem?.querySelector(".ant-form-item-label")?.textContent?.trim();
        if (antLabel) return antLabel.replace(/[*：:]\s*$/, "");
        const elItem = el.closest(".el-form-item");
        const elLabel = elItem?.querySelector(".el-form-item__label")?.textContent?.trim();
        if (elLabel) return elLabel.replace(/[*：:]\s*$/, "");
        return "";
      }
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
          label: labelOf(el),
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
      // 展开中的组件库下拉:把可见选项一并列出(agent 无需再 eval 探查)。
      const dropdownOptions = Array.from(document.querySelectorAll(optionSelector))
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 50);
      return { elements: out, dropdownOptions };
    },
    [max, DROPDOWN_OPTION_SELECTOR] as const,
  );
  return { count: data.elements.length, elements: data.elements, dropdownOptions: data.dropdownOptions };
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
  if (cond.ref !== undefined) {
    // aria 快照 ref:解析后按 state 等待(默认 visible)
    const state = String(cond.state ?? "visible");
    try {
      const target = await targetLocator(page, { ref: cond.ref });
      await target.waitFor({ state: state as any, timeout: 120 });
      return { ok: true };
    } catch {
      return { ok: false, detail: `ref ${String(cond.ref)} 未达到 ${state}` };
    }
  }
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

/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。visual 断言走像素比对。 */
export async function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  if (args.visual !== undefined && typeof args.visual === "object") {
    return visualAssert(config, args.visual, page, exec);
  }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 5_000) || 5_000, 100), 60_000);
  const intervalMs = Math.max(Number(args.intervalMs ?? 300) || 300, 50);
  const result = await pollCondition(page, args.condition, timeoutMs, intervalMs);
  if (result.ok) {
    return { passed: true, ...(await pageIdentity(page)) };
  }
  // 失败:自动截图存证据目录,抛错携带原因与路径。
  const cwd = workspaceBaseDir(config, exec);
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

/**
 * 页内像素比对(自包含函数,page.evaluate 序列化注入):
 * 两张图按传入的 w/h 重绘,mask 区域填白后逐像素比较
 * (加权亮度差 / 255 > threshold 计为差异像素),差异像素在 diff 图上标红。
 * 注意:公式与测试里的 luminanceDelta 语义保持一致(0.2126/0.7152/0.0722)。
 */
async function compareImagesInPage(payload: {
  baseline: string;
  current: string;
  threshold: number;
  maskRects: { x: number; y: number; width: number; height: number }[];
  width: number;
  height: number;
}): Promise<{
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffImage: string | null;
}> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("image decode failed"));
      img.src = src;
    });
  const [a, b] = await Promise.all([load(payload.baseline), load(payload.current)]);
  const { width: w, height: h } = payload;
  const draw = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx;
  };
  const ctxA = draw(a);
  const ctxB = draw(b);
  for (const r of payload.maskRects) {
    for (const ctx of [ctxA, ctxB]) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
  }
  const da = ctxA.getImageData(0, 0, w, h).data;
  const db = ctxB.getImageData(0, 0, w, h).data;
  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = w;
  diffCanvas.height = h;
  const dctx = diffCanvas.getContext("2d")!;
  dctx.drawImage(b, 0, 0, w, h);
  const dd = dctx.getImageData(0, 0, w, h);
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d =
      0.2126 * Math.abs(da[i] - db[i]) +
      0.7152 * Math.abs(da[i + 1] - db[i + 1]) +
      0.0722 * Math.abs(da[i + 2] - db[i + 2]);
    if (d / 255 > payload.threshold) {
      diff++;
      dd.data[i] = 255;
      dd.data[i + 1] = 0;
      dd.data[i + 2] = 0;
      dd.data[i + 3] = 255;
    }
  }
  const total = w * h;
  return {
    diffPixels: diff,
    totalPixels: total,
    diffRatio: total > 0 ? diff / total : 0,
    diffImage: diff > 0 ? diffCanvas.toDataURL("image/png") : null,
  };
}

/**
 * 视觉回归断言:与基线截图比对。基线缺失时报错提示先建基线;
 * diffRatio 超过 maxDiffRatio 时落盘当前截图与 diff 图并抛错。
 */
async function visualAssert(
  config: BrowserConfig,
  visual: Record<string, any>,
  page: Page,
  exec?: ToolRunContext,
) {
  const baselineName = sanitizeName(String(visual.baseline ?? ""));
  if (baselineName === "") throw new Error("visual 断言需要 baseline(基线名)");
  const cwd = workspaceBaseDir(config, exec);
  const baselineDir = config.baselineDir ?? ".dsh-browser/baselines";
  const dir = isAbsolute(baselineDir) ? baselineDir : resolve(cwd, baselineDir);
  const baselinePath = join(dir, `${baselineName}.png`);
  if (!existsSync(baselinePath)) {
    throw new Error(
      `视觉基线不存在: ${baselinePath};先用 browser_screenshot { baseline: "${baselineName}" } 建立基线`,
    );
  }
  const baselineBuf = readFileSync(baselinePath);
  const currentBuf = await page.screenshot({ type: "png" });
  const baseSize = pngSize(baselineBuf);
  const curSize = pngSize(currentBuf);
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const shotDir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);

  const saveEvidence = (suffix: string, data: Buffer | string): string => {
    mkdirSync(shotDir, { recursive: true });
    const p = join(shotDir, `visual-${sanitizeName(baselineName)}-${suffix}-${Date.now()}.png`);
    writeFileSync(p, typeof data === "string" ? Buffer.from(data.split(",")[1] ?? "", "base64") : data);
    noteScreenshotDir(shotDir);
    return p;
  };

  if (baseSize.width !== curSize.width || baseSize.height !== curSize.height) {
    const currentPath = saveEvidence("current", currentBuf);
    throw new Error(
      `视觉回归失败: 尺寸不一致(基线 ${baseSize.width}x${baseSize.height},当前 ${curSize.width}x${curSize.height}); 当前截图: ${currentPath}`,
    );
  }

  // mask: 当前页上命中选择器的区域(按缩放比例换算后两图同步填白)
  const maskSelectors: string[] = Array.isArray(visual.mask) ? visual.mask.map(String) : [];
  const rawRects: { x: number; y: number; width: number; height: number }[] = [];
  for (const sel of maskSelectors) {
    const rects = await page
      .locator(sel)
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      )
      .catch(() => []);
    rawRects.push(...rects);
  }
  // 大图先缩放到 1000px 边长再比对(性能与精度折中,README 注明)
  const scale = Math.min(1, 1000 / Math.max(curSize.width, curSize.height));
  const w = Math.max(1, Math.round(curSize.width * scale));
  const h = Math.max(1, Math.round(curSize.height * scale));

  const result = await page.evaluate(compareImagesInPage, {
    baseline: `data:image/png;base64,${baselineBuf.toString("base64")}`,
    current: `data:image/png;base64,${currentBuf.toString("base64")}`,
    threshold: Math.min(Math.max(Number(visual.threshold ?? 0.1) || 0.1, 0), 1),
    maskRects: scaleRects(rawRects, scale),
    width: w,
    height: h,
  });

  const maxDiffRatio = Math.min(Math.max(Number(visual.maxDiffRatio ?? 0.005) || 0, 0), 1);
  if (result.diffRatio > maxDiffRatio) {
    const currentPath = saveEvidence("current", currentBuf);
    const diffPath = result.diffImage !== null ? saveEvidence("diff", result.diffImage) : "(无 diff 图)";
    throw new Error(
      `视觉回归失败: diffRatio ${(result.diffRatio * 100).toFixed(3)}%(${result.diffPixels}/${result.totalPixels} 像素)> 阈值 ${(maxDiffRatio * 100).toFixed(3)}%; 当前截图: ${currentPath}; diff 图: ${diffPath}`,
    );
  }
  return {
    passed: true,
    visual: {
      baseline: baselineName,
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
    },
    ...(await pageIdentity(page)),
  };
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
    return { cleared: true, entries: [] };
  }
  if (action === "wait") {
    if (!args.url) throw new Error("wait 需要 url(正则字符串)");
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 60_000);
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      const hit = [...entries]
        .reverse()
        .find((e) => {
          if (!new RegExp(String(args.url)).test(e.url)) return false;
          if (args.status !== undefined && Number(args.status) !== e.status) return false;
          return true;
        });
      if (hit !== undefined) return { matched: hit, waitMs: Date.now() - startedAt };
      await new Promise((r) => setTimeout(r, 300));
    }
    // 超时:附最近 5 条已见请求,帮助区分「正则没写对」与「请求根本没发」。
    const recent = entries.slice(-5).map(
      (e) => `${e.method} ${e.url} → ${e.failed ? "FAILED" : (e.status ?? "?")}`,
    );
    throw new Error(
      `等待接口超时(${timeoutMs}ms): ${args.url}\n` +
        (recent.length > 0 ? `最近已见请求:\n  ${recent.join("\n  ")}` : "期间无任何接口请求记录"),
    );
  }
  const filter = action === "failed" ? { failedOnly: true } : args;
  const list = [...entries].reverse().filter((e) => matchNetwork(e, filter)).slice(0, Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200));
  if (action === "stats") {
    // 按 host 聚合:总数/失败数/平均耗时/状态码分布(测试收尾一屏看完)。
    const byHost = new Map<string, { host: string; total: number; failed: number; totalMs: number; withDuration: number; byStatus: Record<string, number> }>();
    for (const e of entries) {
      let host: string;
      try {
        host = new URL(e.url).host;
      } catch {
        host = "(invalid-url)";
      }
      let bucket = byHost.get(host);
      if (bucket === undefined) {
        bucket = { host, total: 0, failed: 0, totalMs: 0, withDuration: 0, byStatus: {} };
        byHost.set(host, bucket);
      }
      bucket.total++;
      if (e.failed === true || (e.status !== undefined && e.status >= 400)) bucket.failed++;
      if (e.durationMs !== undefined) {
        bucket.totalMs += e.durationMs;
        bucket.withDuration++;
      }
      if (e.status !== undefined) {
        const key = String(e.status);
        bucket.byStatus[key] = (bucket.byStatus[key] ?? 0) + 1;
      }
    }
    const stats = [...byHost.values()]
      .map((b) => ({
        host: b.host,
        total: b.total,
        failed: b.failed,
        avgMs: b.withDuration > 0 ? Math.round(b.totalMs / b.withDuration) : null,
        byStatus: b.byStatus,
      }))
      .sort((a, b) => b.total - a.total);
    return { stats };
  }
  if (action === "failed") return { failed: list };
  if (action === "list") return { entries: list };
  throw new Error(`unknown network action: ${action}`);
}

/** 只读工具集合:stripReads 保存时剔除(browser_cookies 仅 list 动作算只读)。 */
const READONLY_TOOLS = new Set([
  "browser_snapshot",
  "browser_elements",
  "browser_eval",
  "browser_network",
  "browser_status",
]);

function isReadonlyStep(step: { tool: string; args: any }): boolean {
  if (READONLY_TOOLS.has(step.tool)) return true;
  if (step.tool === "browser_cookies") return (step.args?.action ?? "list") === "list";
  return false;
}

// ---------------------------------------------------------------------------
// 选择器自愈:录制时采指纹,回放/批处理失败时按降级链重试
// ---------------------------------------------------------------------------

/** 使用 args.selector 定位的工具集合(自愈与录制指纹的作用范围)。 */
export const SELECTOR_STEP_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_select",
  "browser_upload",
]);

/**
 * 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
 * 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
 */
export async function captureSelectorHint(page: Page, selector: string): Promise<SelectorHint | null> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
      const implicit =
        tag === "a" && el.hasAttribute("href") ? "link"
        : tag === "button" || tag === "summary" || (tag === "input" && ["button", "submit", "reset", "image"].includes(type)) ? "button"
        : tag === "textarea" || (tag === "input" && !["hidden", "checkbox", "radio", "file"].includes(type)) ? "textbox"
        : tag === "select" ? "combobox"
        : tag === "input" && type === "checkbox" ? "checkbox"
        : tag === "input" && type === "radio" ? "radio"
        : "";
      const text = ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
      const name =
        (el.getAttribute("aria-label") ?? "").trim() ||
        (el.getAttribute("placeholder") ?? "").trim() ||
        text;
      return {
        testid: el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? undefined,
        id: el.id !== "" ? el.id : undefined,
        tag,
        role: (roleAttr || implicit) !== "" ? roleAttr || implicit : undefined,
        name: name !== "" ? name : undefined,
        text: text !== "" ? text : undefined,
      };
    })
    .catch(() => null);
}

/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
export function healCandidates(hint: SelectorHint): { via: string; selector: string }[] {
  const out: { via: string; selector: string }[] = [];
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (hint.testid !== undefined && hint.testid !== "") {
    out.push({ via: "testid", selector: `css=[data-testid="${q(hint.testid)}"]` });
  }
  if (hint.role !== undefined && hint.role !== "" && hint.name !== undefined && hint.name !== "") {
    out.push({ via: "role+name", selector: `role=${hint.role}[name="${q(hint.name)}"]` });
  }
  if (hint.text !== undefined && hint.text !== "") {
    out.push({ via: "text", selector: `text="${q(hint.text)}"` });
  }
  if (hint.id !== undefined && hint.id !== "") {
    out.push({ via: "id", selector: `css=[id="${q(hint.id)}"]` });
  }
  if (hint.tag !== undefined && hint.tag !== "" && hint.text !== undefined && hint.text !== "") {
    out.push({ via: "tag+text", selector: `css=${hint.tag}:has-text("${q(hint.text)}")` });
  }
  return out;
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
    // 数据源:优先最近一次完整录制(start→stop);从未录制则回退到全局轨迹最近 100 条。
    const recorded = lastRecordingOf();
    const source = recorded !== null ? "recording" : "recent-log";
    const rawSteps: ReplayStep[] = recorded !== null
      ? recorded.map((c) => ({ tool: c.tool, args: c.args ?? {}, ...(c.meta !== undefined ? { meta: c.meta } : {}) }))
      : testLogOf().reverse().slice(-100).map((c) => ({ tool: c.tool, args: c.args ?? {}, ...(c.meta !== undefined ? { meta: c.meta } : {}) }));
    // stripReads: 剔除只读探查步骤(snapshot/elements/eval/network/status/cookies list),
    // 让回放更聚焦操作路径。注意 browser_eval 可能有副作用,默认关闭由调用方判断。
    const steps = args.stripReads === true ? rawSteps.filter((s) => !isReadonlyStep(s)) : rawSteps;
    const stripped = rawSteps.length - steps.length;
    // 参数化:vars = { 变量名: "#步骤号.args.字段路径" }(步骤号 1 起),
    // 把指定字段的值替换为 {{变量名}} 占位符,回放时由 browser_replay 注入真实值。
    let varsApplied = 0;
    if (args.vars !== undefined && typeof args.vars === "object" && args.vars !== null) {
      for (const [varName, path] of Object.entries(args.vars as Record<string, unknown>)) {
        const m = /^#(\d+)\.args\.([\w.]+)$/.exec(String(path));
        if (m === null) throw new Error(`vars.${varName}: 路径格式应为 "#步骤号.args.字段"(如 "#3.args.text"),实际: ${String(path)}`);
        const idx = Number(m[1]) - 1;
        const step = steps[idx];
        if (step === undefined) throw new Error(`vars.${varName}: 步骤 #${m[1]} 不存在(共 ${steps.length} 步)`);
        setPath(step.args, m[2], `{{${varName}}}`);
        varsApplied++;
      }
    }
    savedRecordings.set(name, { steps, savedAt: Date.now() });
    const file = saveRecordingFile(name, steps);
    // 外部依赖检查:upload 步骤引用的本地文件不存在时预警(回放将失败)。
    const warnings: string[] = [];
    steps.forEach((s, i) => {
      if (s.tool !== "browser_upload") return;
      const p = s.args?.path;
      if (typeof p === "string" && p.length > 0 && !existsSync(p)) {
        warnings.push(`#${i + 1} browser_upload: 文件不存在 ${p},回放此步骤将失败`);
      }
    });
    return {
      saved: name,
      steps: steps.length,
      source,
      file,
      ...(stripped > 0 ? { stripped } : {}),
      ...(varsApplied > 0 ? { varsApplied } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      hint: "已持久化到磁盘,重启 DSH 后仍可回放",
    };
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

/** 回放选项(自愈开关与单次尝试超时,来自 config)。 */
export interface ReplayOptions {
  healing?: boolean;
  healTimeoutMs?: number;
}

/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
export async function runReplay(
  steps: ReplayStep[],
  impls: Record<string, (args: any) => Promise<unknown>>,
  failFast: boolean,
  opts: ReplayOptions = {},
): Promise<{ total: number; passed: number; failed: number; healedCount: number; stoppedAt?: number; results: any[] }> {
  const results: any[] = [];
  let stoppedAt: number | null = null;
  let passed = 0;
  let healedCount = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const impl = impls[step.tool];
    if (impl === undefined) {
      results.push({ index: i, tool: step.tool, ok: false, error: `未知步骤工具: ${step.tool}` });
      if (failFast) { stoppedAt = i; break; }
      continue;
    }
    const hint = step.meta?.hint;
    const canHeal =
      opts.healing === true &&
      hint !== undefined &&
      SELECTOR_STEP_TOOLS.has(step.tool) &&
      typeof step.args?.selector === "string";
    if (!canHeal) {
      try {
        await impl(step.args ?? {});
        passed++;
        results.push({ index: i, tool: step.tool, ok: true });
      } catch (e) {
        results.push({ index: i, tool: step.tool, ok: false, error: e instanceof Error ? e.message : String(e) });
        if (failFast) { stoppedAt = i; break; }
      }
      continue;
    }
    // 自愈路径:原选择器用较短超时先试,失败再按降级链逐个候选重试。
    const healTimeout = opts.healTimeoutMs ?? 3000;
    const quickArgs = {
      ...step.args,
      timeoutMs: Math.min(Number(step.args.timeoutMs ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY, healTimeout),
    };
    try {
      await impl(quickArgs);
      passed++;
      results.push({ index: i, tool: step.tool, ok: true });
      continue;
    } catch (e0) {
      const tried: string[] = [];
      let healed: { via: string; selector: string } | null = null;
      for (const candidate of healCandidates(hint)) {
        tried.push(`${candidate.via}: ${candidate.selector}`);
        try {
          await impl({ ...step.args, selector: candidate.selector, timeoutMs: healTimeout });
          healed = candidate;
          break;
        } catch {
          /* 尝试下一个候选 */
        }
      }
      if (healed !== null) {
        passed++;
        healedCount++;
        results.push({
          index: i,
          tool: step.tool,
          ok: true,
          healed: true,
          via: healed.via,
          resolved: healed.selector,
        });
      } else {
        const base = e0 instanceof Error ? e0.message : String(e0);
        results.push({
          index: i,
          tool: step.tool,
          ok: false,
          error: `${base}${tried.length > 0 ? `; 自愈已尝试: ${tried.join(" | ")}` : ""}`,
        });
        if (failFast) { stoppedAt = i; break; }
      }
    }
  }
  return {
    total: steps.length,
    passed,
    failed: results.length - passed,
    healedCount,
    // null 不输出:outputSchema 中 stoppedAt 为 integer,省略比 null 兼容性更稳。
    ...(stoppedAt !== null ? { stoppedAt } : {}),
    results,
  };
}

// ---------------------------------------------------------------------------
// browser_extract:规则化抽取(CSS/attr,不含模型)+ 翻页聚合 + CSV/JSONL 落盘
// ---------------------------------------------------------------------------

export interface ExtractField {
  name: string;
  selector: string;
  attr?: string;
  multiple?: boolean;
  fields?: ExtractField[];
}

/**
 * 页内抽取(自包含函数,page.evaluate 序列化注入):
 * attr 缺省取可见文本(innerText/textContent),否则 getAttribute(attr);
 * multiple 收集所有命中;fields 嵌套时在每个命中元素内递归抽取。
 */
function extractFieldsInPage(fields: ExtractField[]): Record<string, any> {
  const val = (el: Element | null, attr?: string): string | null => {
    if (el === null) return null;
    if (attr !== undefined && attr !== "" && attr !== "text" && attr !== "textContent") {
      return el.getAttribute(attr);
    }
    return ((el as HTMLElement).innerText || el.textContent || "").trim();
  };
  const run = (scope: Element | Document, spec: ExtractField[]): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const f of spec) {
      const els = Array.from(scope.querySelectorAll(f.selector));
      if (f.multiple === true) {
        if (Array.isArray(f.fields) && f.fields.length > 0) {
          out[f.name] = els.map((el) => run(el, f.fields!));
        } else {
          out[f.name] = els.map((el) => val(el, f.attr));
        }
      } else {
        const el = els[0] ?? null;
        if (el !== null && Array.isArray(f.fields) && f.fields.length > 0) {
          out[f.name] = run(el, f.fields);
        } else {
          out[f.name] = val(el, f.attr);
        }
      }
    }
    return out;
  };
  return run(document, fields);
}

/**
 * 把单页抽取结果规整为行数组:恰好一个顶层 multiple 字段时,其数组即行
 * (行内嵌套对象为行,标量包装成 { [name]: value });否则整页算一行。
 */
export function rowsOfExtract(result: Record<string, any>, fields: ExtractField[]): Record<string, any>[] {
  const multi = fields.filter((f) => f.multiple === true);
  if (multi.length === 1) {
    const name = multi[0].name;
    const arr = Array.isArray(result[name]) ? result[name] : [];
    return arr.map((item: any) =>
      item !== null && typeof item === "object" ? (item as Record<string, any>) : { [name]: item },
    );
  }
  return [result];
}

/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export function workspaceFilePath(cwd: string, file: string): string {
  const p = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
  const root = resolve(cwd);
  if (p !== root && !p.startsWith(root + "/") && !p.startsWith(root + "\\")) {
    throw new Error(`文件路径越出工作区: ${file}`);
  }
  return p;
}

/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
export async function extractTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  const fields = args.fields as ExtractField[];
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("extract 需要 fields:[{ name, selector, attr?, multiple?, fields? }]");
  }
  for (const f of fields) {
    if (typeof f?.name !== "string" || f.name === "" || typeof f?.selector !== "string" || f.selector === "") {
      throw new Error("fields 每项需要非空 name 与 selector");
    }
  }
  const maxPages = Math.min(Math.max(Number(args.maxPages ?? 1) || 1, 1), 100);
  const maxRows = Math.min(Math.max(Number(args.maxRows ?? config.maxRows ?? 1000) || 1000, 1), 100_000);
  const waitAfterMs = Math.min(Math.max(Number(args.waitAfterMs ?? 800) || 0, 0), 10_000);

  const rows: Record<string, any>[] = [];
  let pages = 0;
  for (;;) {
    const result = await page.evaluate(extractFieldsInPage, fields);
    rows.push(...rowsOfExtract(result, fields));
    pages++;
    if (rows.length >= maxRows) break;
    const nextSel = typeof args.next === "string" && args.next !== "" ? args.next : null;
    if (nextSel === null || pages >= maxPages) break;
    const next = page.locator(nextSel).first();
    if ((await next.count().catch(() => 0)) === 0) break;
    const usable = await next
      .evaluate((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const visible = style.visibility !== "hidden" && style.display !== "none" && (rect.width > 0 || rect.height > 0);
        const disabled =
          (el as HTMLButtonElement).disabled === true ||
          el.getAttribute("aria-disabled") === "true" ||
          el.classList.contains("disabled") ||
          el.classList.contains("ant-pagination-disabled");
        return visible && !disabled;
      })
      .catch(() => false);
    if (!usable) break;
    await next.click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    if (waitAfterMs > 0) await page.waitForTimeout(waitAfterMs);
  }

  const truncated = rows.length > maxRows;
  const finalRows = truncated ? rows.slice(0, maxRows) : rows;
  const format =
    typeof args.format === "string" && args.format !== ""
      ? args.format
      : (typeof args.file === "string" ? formatFromFile(args.file) : null) ?? "json";
  if (!["json", "csv", "jsonl", "markdown"].includes(format)) {
    throw new Error(`未知 format: ${format}(支持 json / csv / jsonl / markdown)`);
  }

  let file: string | undefined;
  let bytes: number | undefined;
  if (typeof args.file === "string" && args.file !== "") {
    const cwd = workspaceBaseDir(config, exec);
    file = workspaceFilePath(cwd, args.file);
    const content = serializeRows(finalRows, format);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    bytes = Buffer.byteLength(content, "utf8");
  }

  return {
    rows: finalRows,
    count: finalRows.length,
    pages,
    format,
    ...(truncated ? { truncated: true } : { truncated: false }),
    ...(file !== undefined ? { file, bytes } : {}),
    ...(await pageIdentity(page)),
  };
}

/** 批处理内禁止嵌套的工具(防 batch→replay→batch 递归与录制自引用)。 */
const BATCH_FORBIDDEN = new Set(["browser_batch", "browser_replay", "browser_record"]);

/**
 * 回归报告:list 列出最近运行,show 看单条详情,
 * export 聚合生成 Markdown/HTML 报告落盘工作区。
 */
export async function reportTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const action = args.action ?? "list";
  if (action === "list") {
    const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 200);
    const runs = listRuns(limit).map((r) => ({
      runId: r.runId,
      ts: r.ts,
      kind: r.kind,
      source: r.source,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      healedCount: r.healedCount,
      durationMs: r.durationMs,
      ...(r.row !== undefined ? { row: r.row } : {}),
    }));
    return { runs };
  }
  if (action === "show") {
    const run = typeof args.runId === "string" && args.runId !== "" ? getRun(args.runId) : latestRun();
    if (run === null) throw new Error(typeof args.runId === "string" ? `无此运行记录: ${args.runId}` : "暂无运行记录(先跑一次 browser_replay)");
    return { run };
  }
  if (action === "export") {
    const format = args.format === "html" ? "html" : "markdown";
    const source = typeof args.source === "string" && args.source !== "" ? args.source : undefined;
    const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 1000);
    const runs = listRuns(limit).filter((r) => source === undefined || r.source === source);
    if (runs.length === 0) throw new Error(source !== undefined ? `来源 "${source}" 暂无运行记录` : "暂无运行记录(先跑一次 browser_replay)");
    const content = format === "html" ? renderHtmlReport(runs, source) : renderMarkdownReport(runs, source);
    const cwd = workspaceBaseDir(config, exec);
    const fileArg =
      typeof args.file === "string" && args.file !== ""
        ? args.file
        : `reports/regression-${new Date().toISOString().slice(0, 10)}.${format === "html" ? "html" : "md"}`;
    const file = workspaceFilePath(cwd, fileArg);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    return {
      file,
      bytes: Buffer.byteLength(content, "utf8"),
      runs: runs.length,
      format,
    };
  }
  throw new Error(`unknown report action: ${action}`);
}

/**
 * 动作批处理:一次调用顺序执行多个浏览器步骤(内核复用 runReplay),
 * 减少「点击→等待→输入」类固定小序列的工具往返。步骤内禁止嵌套
 * batch/replay/record;批整体在操作轨迹里记为一条 browser_batch。
 */
export async function batchTool(
  args: Record<string, any>,
  impls: Record<string, (args: any) => Promise<unknown>>,
  config?: BrowserConfig,
) {
  const steps = args.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("batch 需要非空 steps 数组:[{ tool, args }]");
  }
  const guarded: Record<string, (args: any) => Promise<unknown>> = { ...impls };
  for (const name of BATCH_FORBIDDEN) {
    guarded[name] = async () => {
      throw new Error(`不允许嵌套: batch 步骤不能调用 ${name}`);
    };
  }
  const failFast = args.failFast !== false;
  const opts: ReplayOptions = {
    healing: config?.selectorHealing !== false,
    healTimeoutMs: config?.healTimeoutMs ?? 3000,
  };
  const t0 = Date.now();
  const result = await runReplay(steps, guarded, failFast, opts);
  noteRun({ kind: "batch", source: "batch", total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount, durationMs: Date.now() - t0, results: result.results });
  const stoppedAt = (result as { stoppedAt?: number }).stoppedAt;
  return {
    ...result,
    summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== undefined ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈` : ""}`,
  };
}

/** 设置嵌套路径的值(路径段按 . 拆分,供 record save 的 vars 占位替换)。 */
function setPath(obj: Record<string, any>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Record<string, any> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const next = cur[segs[i]];
    if (next === null || typeof next !== "object") throw new Error(`路径不存在: ${path}`);
    cur = next as Record<string, any>;
  }
  cur[segs[segs.length - 1]] = value;
}

/** 收集步骤中所有 {{var}} 占位符名(导出供测试)。 */
export function findPlaceholders(steps: ReplayStep[]): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\{\{([\w-]+)\}\}/g)) found.add(m[1]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v !== null && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  steps.forEach((s) => walk(s.args));
  return [...found];
}

/**
 * 深拷贝步骤并替换字符串叶子里的 {{var}} 占位符(导出供测试)。
 * vars 缺失的占位符保留原样(由调用方先 findPlaceholders 校验)。
 */
export function substituteVars(steps: ReplayStep[], vars: Record<string, unknown>): ReplayStep[] {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(/\{\{([\w-]+)\}\}/g, (whole, name) =>
        name in vars ? String(vars[name]) : whole,
      );
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return steps.map((s) => ({ ...s, args: walk(s.args) as Record<string, any> }));
}

/** 运行结果落一条运行记录(runs.jsonl);失败静默,不阻断主流程。 */
function noteRun(record: Omit<RunRecord, "runId" | "ts">): void {
  try {
    const ts = Date.now();
    appendRun({ runId: makeRunId(ts), ts, ...record });
  } catch {
    /* 报告写入失败不影响回放 */
  }
}

/**
 * 回放入口:name(已保存录制)或 steps(数组)二选一。
 * vars 注入 {{占位符}};data/dataFile 数据集模式逐行运行并聚合。
 */
export async function replayTool(
  args: Record<string, any>,
  impls: Record<string, (args: any) => Promise<unknown>>,
  config?: BrowserConfig,
  exec?: ToolRunContext,
) {
  let steps: ReplayStep[] = [];
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
  const opts: ReplayOptions = {
    healing: config?.selectorHealing !== false,
    healTimeoutMs: config?.healTimeoutMs ?? 3000,
  };

  // 数据集模式:data 数组或 dataFile(CSV,首行为变量名),逐行运行。
  let rows: Record<string, unknown>[] | null = null;
  if (Array.isArray(args.data)) {
    rows = args.data as Record<string, unknown>[];
  } else if (typeof args.dataFile === "string" && args.dataFile !== "") {
    const cwd = workspaceBaseDir(config ?? {}, exec);
    const file = workspaceFilePath(cwd, args.dataFile);
    if (!existsSync(file)) throw new Error(`dataFile 不存在: ${file}`);
    rows = parseCsv(readFileSync(file, "utf8"));
  }
  if (rows !== null) {
    if (rows.length === 0) throw new Error("数据集为空(0 行)");
    const placeholders = findPlaceholders(steps);
    const runs: any[] = [];
    let okRows = 0;
    for (let i = 0; i < rows.length; i++) {
      const rowVars = { ...(args.vars as Record<string, unknown> | undefined), ...rows[i] };
      const missing = placeholders.filter((p) => !(p in rowVars));
      const t0 = Date.now();
      if (missing.length > 0) {
        runs.push({ row: i, total: steps.length, passed: 0, failed: steps.length, healedCount: 0, results: [], error: `缺少变量: ${missing.join(", ")}` });
        noteRun({ kind: "replay", source, total: steps.length, passed: 0, failed: steps.length, healedCount: 0, durationMs: Date.now() - t0, row: i, results: [] });
        continue;
      }
      const result = await runReplay(substituteVars(steps, rowVars), impls, failFast, opts);
      const stoppedAt = (result as { stoppedAt?: number }).stoppedAt;
      runs.push({ row: i, ...result });
      if (result.failed === 0) okRows++;
      noteRun({ kind: "replay", source, total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount, durationMs: Date.now() - t0, row: i, results: result.results });
      void stoppedAt;
    }
    return {
      source,
      rows: rows.length,
      passedRows: okRows,
      failedRows: rows.length - okRows,
      runs,
      summary: `数据集 ${okRows}/${rows.length} 行通过${okRows < rows.length ? `,${rows.length - okRows} 行失败` : ""}`,
    };
  }

  // 单次运行:vars 注入(缺失占位符直接报错,不做空串替换)。
  const vars = (args.vars as Record<string, unknown> | undefined) ?? {};
  const missing = findPlaceholders(steps).filter((p) => !(p in vars));
  if (missing.length > 0) {
    throw new Error(`缺少变量: ${missing.join(", ")}(录制含 {{占位符}},请用 vars 提供)`);
  }
  const t0 = Date.now();
  const result = await runReplay(substituteVars(steps, vars), impls, failFast, opts);
  const stoppedAt = (result as { stoppedAt?: number }).stoppedAt;
  noteRun({ kind: "replay", source, total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount, durationMs: Date.now() - t0, results: result.results });
  return {
    source,
    ...result,
    summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== undefined ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈(建议修复录制选择器)` : ""}`,
  };
}
