// dsh-browser · 浏览器 — 会话与标签页管理 (核心调度与门面)
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request } from "playwright-core";
import type { BrowserConfig, ProfileState, DownloadEntry, FormField, NavEntry, RefEntry, ReplayStep, SelectorHint } from "./types.js";
import { injectWalker } from "./walker.js";

export * from "./session/cache.js";
export * from "./session/collaboration.js";
export * from "./session/recorder.js";
export * from "./session/screenshot.js";

import { clearPageRefs } from "./session/cache.js";
import { HUMAN_BINDING, handleHumanEvent, installHumanRecorder } from "./session/recorder.js";
import { adapterRegistry } from "./adapters/index.js";

/** 当前活动 profile 名(默认 "default")。 */
export let currentProfile = "default";
/** 多配置文件浏览器会话:name → 会话状态。 */
export const profileStates = new Map<string, ProfileState>();
/** 最近下载记录 [{ download, suggestedFilename, at }](按 profile 名隔离)。 */
const downloadsByProfile = new Map<string, DownloadEntry[]>();
/** 页面访问历史(按 profile 名隔离)。不随 closeBrowser 清空,DSH 重启才重置。 */
const historyByProfile = new Map<string, NavEntry[]>();
/** 已保存的表单回放:name → fields 数组。 */
export const savedForms = new Map<string, FormField[]>();
/** 最近一次 browser_form 填充的字段(供 browser_form_save 无参保存)。 */
export let lastFormFields: FormField[] = [];


/** 网络请求/响应记录。 */
export interface NetworkEntry {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  ok?: boolean;
  failed?: boolean;
  error?: string;
  startedAt: number;
  durationMs?: number;
  /** 请求体(截断,默认记录)。 */
  postData?: string | null;
  /** 响应体(截断,默认记录;SSE 与大响应跳过)。 */
  body?: string | null;
}

const networkByProfile = new Map<string, NetworkEntry[]>();

function networkOf(name: string): NetworkEntry[] {
  let list = networkByProfile.get(name);
  if (list === undefined) {
    list = [];
    networkByProfile.set(name, list);
  }
  return list;
}

export function networkEntries(name: string): NetworkEntry[] {
  return networkOf(name);
}

export function addNetworkEntry(profile: string, entry: NetworkEntry): void {
  const list = networkOf(profile);
  list.push(entry);
  if (list.length > 500) list.shift();
}

export function clearNetwork(profile: string): void {
  networkByProfile.delete(profile);
}

export function profileConfig(config: BrowserConfig, name: string): BrowserConfig {
  const named = config.profiles?.[name];
  if (!named || typeof named !== "object") return { ...config };
  return {
    ...config,
    ...named,
    profiles: config.profiles,
  };
}

export function getProfileState(name: string): ProfileState {
  let state = profileStates.get(name);
  if (state === undefined) {
    state = { browser: null, context: null, persistent: false, pages: new Map(), activeId: null, counter: 0 };
    profileStates.set(name, state);
  }
  return state;
}

export function downloadsOf(name: string): DownloadEntry[] {
  let list = downloadsByProfile.get(name);
  if (list === undefined) {
    list = [];
    downloadsByProfile.set(name, list);
  }
  return list;
}

/** 某 profile 的访问历史(按时间先后)。 */
export function historyOf(name: string): NavEntry[] {
  let list = historyByProfile.get(name);
  if (list === undefined) {
    list = [];
    historyByProfile.set(name, list);
  }
  return list;
}

/** 把一次主 frame 导航记入该 profile 的访问历史(去重 + 上限 50 条)。 */
function recordNav(profile: string, url: string): NavEntry {
  const list = historyOf(profile);
  const last = list[list.length - 1];
  if (last !== undefined && last.url === url) {
    last.ts = Date.now(); // 同 URL 重载:刷新时间戳
    return last;
  }
  const entry: NavEntry = { url, title: "", ts: Date.now() };
  list.push(entry);
  if (list.length > 50) list.shift();
  return entry;
}

export function attachPage(page: Page, config: BrowserConfig): void {
  const timeoutMs = config.timeoutMs ?? 30000;
  page.setDefaultTimeout(timeoutMs);
  page.addInitScript("window.__name = (t, v) => t; globalThis.__name = (t, v) => t;").catch(() => {});
  page.on("download", (download) => {
    const list = downloadsOf(currentProfile);
    list.push({ download, suggestedFilename: download.suggestedFilename(), at: Date.now() });
    if (list.length > 20) list.shift();
  });
  // 访问历史:记录主 frame 导航,load 后异步补齐标题。
  const profile = currentProfile;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    // 导航后旧 ref 全部失效(元素可能已不存在),防 ref 漂移误点。
    clearPageRefs(page);
    adapterRegistry.clearCache(page);
    const url = frame.url();
    if (!url || url === "about:blank") return;
    recordNav(profile, url);
  });
  page.on("load", () => {
    const list = historyOf(profile);
    const entry = list[list.length - 1];
    if (entry === undefined) return;
    page
      .title()
      .then((t) => {
        if (t) entry.title = t;
      })
      .catch(() => {});
  });
  // 网络记录:只跟踪 XHR/fetch 接口请求(测试断言用),按 profile 隔离。
  // recordBodies 开启时记录请求体/响应体(截断;SSE 流与超大响应跳过)。
  const recordBodies = config.recordBodies !== false;
  const pendingReqs = new WeakMap<Request, { url: string; method: string; startedAt: number; postData: string | null }>();
  page.on("request", (req) => {
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
    let postData: string | null = null;
    if (recordBodies) {
      try {
        const raw = req.postData();
        if (raw) postData = raw.length > 2000 ? `${raw.slice(0, 2000)}…(截断)` : raw;
      } catch {
        /* 读取失败忽略 */
      }
    }
    pendingReqs.set(req, { url: req.url(), method: req.method(), startedAt: Date.now(), postData });
  });
  page.on("response", async (res) => {
    const req = res.request();
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
    const info = pendingReqs.get(req);
    if (info === undefined) return;
    let body: string | null = null;
    if (recordBodies) {
      try {
        const headers = res.headers();
        const contentType = (headers["content-type"] ?? "").toLowerCase();
        const contentLength = Number(headers["content-length"] ?? 0);
        // 跳过 SSE 流(永不结束)与超大响应(>500KB),避免挂起/内存膨胀。
        if (!contentType.includes("text/event-stream") && !(contentLength > 500_000)) {
          const text = await res.text();
          if (text) body = text.length > 4000 ? `${text.slice(0, 4000)}…(截断)` : text;
        }
      } catch {
        /* 响应体读取失败忽略 */
      }
    }
    addNetworkEntry(profile, {
      url: res.url(),
      method: info.method,
      resourceType: req.resourceType(),
      status: res.status(),
      ok: res.ok(),
      startedAt: info.startedAt,
      durationMs: Date.now() - info.startedAt,
      postData: info.postData,
      body,
    });
  });
  page.on("requestfailed", (req) => {
    if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
    const info = pendingReqs.get(req);
    if (info === undefined) return;
    addNetworkEntry(profile, {
      url: req.url(),
      method: info.method,
      resourceType: req.resourceType(),
      failed: true,
      error: req.failure()?.errorText ?? "failed",
      startedAt: info.startedAt,
      durationMs: Date.now() - info.startedAt,
    });
  });
  // 人工操作录制:exposeBinding 常驻(对后续导航生效),init script 每次导航自动
  // 重装监听;node 侧只在 recording 开启时生效。失败(旧页面已绑定等)静默忽略。
  void page
    .exposeBinding(HUMAN_BINDING, (_source: unknown, payload: unknown) => {
      handleHumanEvent(payload);
      return null;
    })
    .then(() => page.addInitScript(installHumanRecorder))
    .then(() => page.evaluate(installHumanRecorder).catch(() => {})) // 已加载的当前文档也装上
    .catch(() => {
      /* 绑定已存在或页面已关闭:忽略 */
    });
}

export async function loadPlaywright(): Promise<typeof import("playwright-core")> {
  try {
    return await import("playwright-core");
  } catch {
    throw new Error(
      "dsh-browser: playwright-core is not installed. Run `dsh plugin --profile web add playwright-core` or install it in the profile.",
    );
  }
}

interface LaunchCandidate {
  headless: boolean;
  channel?: string;
  executablePath?: string;
}

export async function launchProfile(name: string, config: BrowserConfig): Promise<void> {
  const pw = await loadPlaywright();
  const state = getProfileState(name);
  const resolved = profileConfig(config, name);
  const base: LaunchCandidate = { headless: resolved.headless ?? false };
  const candidates: LaunchCandidate[] = [];
  if (resolved.executablePath) {
    candidates.push({ ...base, executablePath: resolved.executablePath });
  } else if (resolved.channel && resolved.channel !== "auto") {
    candidates.push({ ...base, channel: resolved.channel });
  } else {
    const order =
      process.platform === "win32"
        ? ["msedge", "chrome", "chromium"]
        : ["chrome", "msedge", "chromium"];
    for (const channel of order) candidates.push({ ...base, channel });
    candidates.push(base); // playwright's own bundled chromium fallback
  }
  let lastError: unknown;
  for (const options of candidates) {
    try {
      if (resolved.userDataDir) {
        // 持久化配置文件目录:登录态(Cookie/localStorage)跨重启保留
        const context = await pw.chromium.launchPersistentContext(resolved.userDataDir, {
          ...options,
          headless: resolved.headless ?? false,
        });
        for (const existing of context.pages()) {
          existing.close().catch(() => {});
        }
        state.browser = null;
        state.context = context;
        state.persistent = true;
        state.channel = options.channel ?? options.executablePath ?? "bundled";
        return;
      }
      const browser = await pw.chromium.launch(options);
      state.browser = browser;
      state.context = null;
      state.persistent = false;
      state.channel = options.channel ?? options.executablePath ?? "bundled";
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `dsh-browser: could not launch a Chromium-based browser. ` +
      `Install one, set config executablePath, or run \`npx playwright install chromium\`. ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** 当前 profile 状态(未启动时创建空状态)。 */
export function stateOf(): ProfileState {
  return getProfileState(currentProfile);
}

// ---------------------------------------------------------------------------
// 命名隔离上下文(browser_context):同一浏览器进程内独立 cookies/storage 的
// "标签组"。页仍注册进 profile 的标签表(既有 tabs/getPage/activePage 全兼容),
// 此处只额外记录 context → 页 id 的归属,供 list/switch/close。
// ---------------------------------------------------------------------------

export interface NamedContext {
  context: BrowserContext;
  pageIds: Set<number>;
  createdAt: number;
}

const namedContexts = new Map<string, NamedContext>();

export function namedContextsOf(): Map<string, NamedContext> {
  return namedContexts;
}

/** 把一个已 attach 的页面注册进 profile 标签表并激活,返回分配的 tab id。 */
export function registerTabPage(state: ProfileState, page: Page): number {
  const id = state.counter++;
  state.pages.set(id, page);
  state.activeId = id;
  return id;
}

/** 新建一个页面(当前 profile 会话未启动时先启动)。 */
export async function newPage(config: BrowserConfig): Promise<Page> {
  const state = stateOf();
  const resolved = profileConfig(config, currentProfile);
  if (state.browser === null && state.context === null) await launchProfile(currentProfile, config);
  const context = state.context;
  const browser = state.browser;
  if (context !== null) {
    const page = await context.newPage();
    attachPage(page, resolved);
    return page;
  }
  if (browser !== null) {
    const page = await browser.newPage();
    attachPage(page, resolved);
    return page;
  }
  throw new Error("dsh-browser: browser session failed to start");
}

/** 返回当前活动页面(没有则新建),并保证浏览器已启动。 */
export async function getPage(config: BrowserConfig): Promise<Page> {
  const state = stateOf();
  if (state.browser === null && state.context === null) await launchProfile(currentProfile, config);
  if (state.pages.size === 0) {
    const page = await newPage(config);
    const id = state.counter++;
    state.pages.set(id, page);
    state.activeId = id;
  }
  const page = state.pages.get(state.activeId ?? -1);
  if (page === undefined) throw new Error("dsh-browser: no active page");
  return page;
}

/** 活动页面(可能为 null,不触发启动)。 */
export function activePage(): Page | null {
  const state = stateOf();
  return state.pages.get(state.activeId ?? -1) ?? null;
}

/** 投影当前 profile 的标签列表。 */
export async function tabList() {
  const state = stateOf();
  const tabs = [];
  for (const [id, page] of state.pages) {
    let title = "";
    try {
      title = await page.title();
    } catch {
      /* closed */
    }
    tabs.push({ id, url: page.url(), title });
  }
  return tabs;
}

export async function closeBrowser(): Promise<void> {
  namedContexts.clear();
  for (const [name, state] of profileStates) {
    const { browser, context } = state;
    state.browser = null;
    state.context = null;
    state.pages = new Map();
    state.activeId = null;
    state.counter = 0;
    try {
      if (context !== null) {
        await context.close();
      } else if (browser !== null) {
        await browser.close();
      }
    } catch {
      /* already closed */
    }
    void name;
  }
  profileStates.clear();
  downloadsByProfile.clear();
}

/** Best-effort current page identity, safe when nothing is open.title 有界防页面忙时挂起。 */
export async function pageIdentity(page: Page) {
  try {
    const title = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("title timeout")), 2_000);
      page.title().then(resolve, reject).finally(() => clearTimeout(t));
    }).catch(() => "");
    return { url: page.url(), title };
  } catch {
    return { url: "", title: "" };
  }
}

/** 设置最近一次表单填充(供 browser_form_save 无参保存)。 */
export function setLastFormFields(fields: FormField[]): void {
  lastFormFields = fields;
}

/** 切换当前 profile。 */
export function setCurrentProfile(name: string): void {
  currentProfile = name;
}

// ---------------------------------------------------------------------------
// 截图清理:每次截图后懒清理 + 每小时定时清扫(只删该目录下的 .png)
