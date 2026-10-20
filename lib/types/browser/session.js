// dsh-browser · 浏览器 — 会话与标签页管理(多 profile、userDataDir 持久化、下载记录、访问历史、截图清理)
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { injectWalker } from "./walker.js";
/** 当前活动 profile 名(默认 "default")。 */
export let currentProfile = "default";
/** 多配置文件浏览器会话:name → 会话状态。 */
export const profileStates = new Map();
/** 最近下载记录 [{ download, suggestedFilename, at }](按 profile 名隔离)。 */
const downloadsByProfile = new Map();
/** 页面访问历史(按 profile 名隔离)。不随 closeBrowser 清空,DSH 重启才重置。 */
const historyByProfile = new Map();
/** 已保存的表单回放:name → fields 数组。 */
export const savedForms = new Map();
/** 最近一次 browser_form 填充的字段(供 browser_form_save 无参保存)。 */
export let lastFormFields = [];
// ---------------------------------------------------------------------------
// ARIA 快照 ref 注册表:page → (ref → 定位信息)。页面导航即失效(防漂移)。
// ---------------------------------------------------------------------------
const refRegistry = new WeakMap();
/** 记录一次 aria 快照分配的 ref(整表替换)。 */
export function setPageRefs(page, refs) {
    refRegistry.set(page, refs);
}
/** 查询某个 ref 的定位信息;未注册返回 undefined。 */
export function pageRef(page, ref) {
    return refRegistry.get(page)?.get(ref);
}
/** 清空页面的 ref 表(导航/新快照时调用)。 */
export function clearPageRefs(page) {
    refRegistry.delete(page);
}
/** 取页面当前完整 ref 表(browser_find 增量续号合并用;无则空 Map)。 */
export function pageRefsOf(page) {
    return refRegistry.get(page) ?? new Map();
}
const snapshotCaches = new WeakMap();
export function snapshotCacheOf(page) {
    return snapshotCaches.get(page);
}
export function setSnapshotCache(page, cache) {
    snapshotCaches.set(page, cache);
}
/** 环形容量钳制(1..20,非法值回落默认 5)。导出供测试。 */
export function snapshotCapacity(k) {
    const n = Math.floor(Number(k));
    if (!Number.isFinite(n))
        return 5;
    return Math.min(Math.max(n, 1), 20);
}
/**
 * 追加一个新版本并淘汰超限的最旧版本(纯逻辑,导出供测试)。
 * cache 为 undefined 时从 version 1 开始;返回新缓存(不修改入参)。
 */
export function pushSnapshotVersion(cache, content, capacity) {
    const version = (cache?.version ?? 0) + 1;
    const k = snapshotCapacity(capacity);
    const history = [...(cache?.history ?? []), { version, text: content.text, aria: content.aria }];
    if (history.length > k)
        history.splice(0, history.length - k);
    return { version, history };
}
/** 按版本号取历史条目;不在环形窗口内(更旧/未知)返回 undefined。 */
export function snapshotVersionEntry(cache, version) {
    if (cache === undefined)
        return undefined;
    return cache.history[cache.history.length - 1]?.version === version
        ? cache.history[cache.history.length - 1]
        : cache.history.find((e) => e.version === version);
}
/** 已保存的录制脚本:name → 步骤数组。 */
export const savedRecordings = new Map();
/** 当前录制中的 buffer(非空 = 录制中)。 */
let recordingSteps = null;
/** 最近一次 start→stop 的录制结果(save 优先使用;下次 start 时覆盖)。 */
let lastRecording = null;
/** 操作轨迹(全局,记录 currentProfile;上限 500 条)。 */
const testLog = [];
export function isRecording() {
    return recordingSteps !== null;
}
export function startRecording() {
    lastRecording = null; // 新一轮录制使上一次结果失效
    recordingSteps = [];
}
export function stopRecording() {
    const steps = recordingSteps ?? [];
    recordingSteps = null;
    lastRecording = steps;
    return steps;
}
/** 最近一次完整录制(start→stop)的 buffer;从未录制过返回 null。 */
export function lastRecordingOf() {
    return lastRecording;
}
/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。返回存入的调用对象(供调用方补 meta)。 */
export function recordCall(call) {
    testLog.push(call);
    if (testLog.length > 500)
        testLog.shift();
    if (recordingSteps !== null && call.tool !== "browser_record" && call.tool !== "browser_replay") {
        recordingSteps.push(call);
        if (recordingSteps.length > 500)
            recordingSteps.shift();
    }
    return call;
}
/** 操作轨迹(按时间倒序,最新在前)。 */
export function testLogOf() {
    return [...testLog].reverse();
}
/**
 * 当前人工接管等待状态(browser_pause_for_human 等待期间非空),
 * 供实时画面面板展示「等待人工操作」提示。
 */
let pauseState = null;
export function setPauseInstruction(instruction) {
    pauseState = { instruction, startedAt: Date.now() };
}
export function clearPauseInstruction() {
    pauseState = null;
}
export function currentPause() {
    return pauseState;
}
let pendingConfirm = null;
export function setPendingConfirm(entry) {
    pendingConfirm = entry;
}
export function getPendingConfirm() {
    return pendingConfirm;
}
export function clearPendingConfirm() {
    pendingConfirm = null;
}
/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
export function resolveConfirm(id, decision) {
    if (pendingConfirm === null || pendingConfirm.id !== id)
        return false;
    pendingConfirm.decision = decision;
    return true;
}
export function clearTestLog() {
    testLog.length = 0;
}
// F2 面板一键重跑的忙碌判定:agent 会话有 live 浏览器工具调用在途时,
// POST /runs/rerun 回 409(面板据此置灰重跑按钮)。
let toolInFlight = 0;
/** live 工具调用开始(register 包装层调用)。 */
export function noteToolStart() {
    toolInFlight++;
}
/** live 工具调用结束(成功/失败都算结束)。 */
export function noteToolEnd() {
    if (toolInFlight > 0)
        toolInFlight--;
}
/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
export function activeToolCalls() {
    return toolInFlight;
}
// ---------------------------------------------------------------------------
// 人工操作进录制轨迹(human-in-the-loop 混合录制):
// 页内监听 click/change → exposeBinding 回传 → 映射为 browser_click/type/select
// 步骤(带选择器指纹)写入录制 buffer;agent 工具驱动的同类事件用时间窗去重。
// ---------------------------------------------------------------------------
/** window 上的回传 binding 名(须为合法 JS 标识符)。 */
export const HUMAN_BINDING = "__dshBrowserHumanEvent";
/** 最近一次 agent DOM 操作(点击/输入/选择)的时间戳;用于区分人手与工具回声。 */
let lastAgentActionAt = 0;
/** agent 即将/刚刚执行了 DOM 操作(register 包装层调用);1.5s 内的页内事件视为工具回声。 */
export function noteAgentAction() {
    lastAgentActionAt = Date.now();
}
/** 导出供测试:距上次 agent 操作是否在去重窗口内。 */
export function agentActionRecent(now = Date.now(), windowMs = 1_500) {
    return now - lastAgentActionAt < windowMs;
}
/**
 * 页内人工操作事件 → 录制步骤(纯函数,导出供测试)。
 * payload 由 installHumanRecorder 生成:{ kind, selector, value?, testid?, role?, name?, id?, text?, tag? }。
 * 无法映射(缺 selector / 未知 kind / 空输入)返回 null。
 */
export function humanEventToStep(payload) {
    if (payload === null || typeof payload !== "object")
        return null;
    const p = payload;
    const selector = typeof p.selector === "string" ? p.selector : "";
    if (!selector)
        return null;
    const hint = {
        ...(p.testid !== undefined && p.testid !== "" ? { testid: String(p.testid) } : {}),
        ...(p.role !== undefined && p.role !== "" ? { role: String(p.role) } : {}),
        ...(p.name !== undefined && p.name !== "" ? { name: String(p.name) } : {}),
        ...(p.id !== undefined && p.id !== "" ? { id: String(p.id) } : {}),
        ...(p.text !== undefined && p.text !== "" ? { text: String(p.text) } : {}),
        ...(p.tag !== undefined && p.tag !== "" ? { tag: String(p.tag) } : {}),
    };
    if (p.kind === "click") {
        return { tool: "browser_click", args: { selector }, meta: { hint, source: "human" } };
    }
    if (p.kind === "input") {
        const text = typeof p.value === "string" ? p.value : "";
        if (text === "")
            return null; // 清空类输入无法可靠回放,跳过
        return { tool: "browser_type", args: { selector, text }, meta: { hint, source: "human" } };
    }
    if (p.kind === "select") {
        const option = typeof p.value === "string" ? p.value.trim() : "";
        if (!option)
            return null;
        return { tool: "browser_select", args: { selector, option }, meta: { hint, source: "human" } };
    }
    return null;
}
/** binding 回调入站口:仅录制中生效;去重窗口内(agent 工具回声)丢弃。 */
function handleHumanEvent(payload) {
    if (!isRecording())
        return;
    if (agentActionRecent())
        return;
    const step = humanEventToStep(payload);
    if (step === null)
        return;
    recordCall({
        tool: step.tool,
        args: step.args,
        ok: true,
        ms: 0,
        ts: Date.now(),
        meta: step.meta,
        source: "human",
    });
}
/**
 * 页内注入的人工操作监听(addInitScript 序列化;每次导航自动重装)。
 * 监听常驻但 node 侧只在录制中生效,关闭录制等价于"移除"。
 * 只上报可交互元素上的 click 与表单控件的 change,避免逐键噪音。
 * F5 收敛:cssPath 等元素描述来自 walker.ts 单一来源(构建期拼装注入),
 * 不再持有内联副本;payload 字段语义与 v0.3 完全一致。
 */
export const installHumanRecorder = injectWalker((_payload, w) => {
    const cssPath = w.cssPath;
    const w2 = window;
    if (w2.__dshHumanRecorder === true)
        return;
    w2.__dshHumanRecorder = true;
    const BINDING = "__dshBrowserHumanEvent";
    const INTERACTIVE = "a,button,input,select,textarea,summary,[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='switch'],[role='checkbox']";
    function payloadOf(el, kind, value) {
        const aria = el.getAttribute("aria-label");
        return {
            kind,
            selector: cssPath(el),
            ...(value !== undefined ? { value } : {}),
            testid: el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "",
            role: el.getAttribute("role") ?? "",
            name: aria && aria.trim() ? aria.trim().slice(0, 40) : "",
            id: el.id ?? "",
            text: (el.innerText || el.textContent || "").trim().slice(0, 40),
            tag: el.tagName.toLowerCase(),
        };
    }
    function send(payload) {
        try {
            const fn = w2[BINDING];
            if (typeof fn === "function")
                void Promise.resolve(fn(payload)).catch(() => { });
        }
        catch {
            /* binding 未就绪(导航瞬间)忽略 */
        }
    }
    document.addEventListener("click", (e) => {
        const target = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
        if (target === null)
            return;
        send(payloadOf(target, "click"));
    }, true);
    document.addEventListener("change", (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (t === null)
            return;
        if (t.tagName === "SELECT") {
            const opt = t.selectedOptions[0];
            send(payloadOf(t, "select", (opt ? opt.textContent : "").trim()));
        }
        else if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
            const type = (t.getAttribute("type") ?? "text").toLowerCase();
            if (type === "checkbox" || type === "radio")
                return; // click 事件已记录
            if (type === "file")
                return; // 文件选择无法回放
            send(payloadOf(t, "input", t.value));
        }
    }, true);
});
const networkByProfile = new Map();
function networkOf(name) {
    let list = networkByProfile.get(name);
    if (list === undefined) {
        list = [];
        networkByProfile.set(name, list);
    }
    return list;
}
export function networkEntries(name) {
    return networkOf(name);
}
export function addNetworkEntry(profile, entry) {
    const list = networkOf(profile);
    list.push(entry);
    if (list.length > 500)
        list.shift();
}
export function clearNetwork(profile) {
    networkByProfile.delete(profile);
}
export function profileConfig(config, name) {
    const named = config.profiles?.[name];
    if (!named || typeof named !== "object")
        return { ...config };
    return {
        ...config,
        ...named,
        profiles: config.profiles,
    };
}
export function getProfileState(name) {
    let state = profileStates.get(name);
    if (state === undefined) {
        state = { browser: null, context: null, persistent: false, pages: new Map(), activeId: null, counter: 0 };
        profileStates.set(name, state);
    }
    return state;
}
export function downloadsOf(name) {
    let list = downloadsByProfile.get(name);
    if (list === undefined) {
        list = [];
        downloadsByProfile.set(name, list);
    }
    return list;
}
/** 某 profile 的访问历史(按时间先后)。 */
export function historyOf(name) {
    let list = historyByProfile.get(name);
    if (list === undefined) {
        list = [];
        historyByProfile.set(name, list);
    }
    return list;
}
/** 把一次主 frame 导航记入该 profile 的访问历史(去重 + 上限 50 条)。 */
function recordNav(profile, url) {
    const list = historyOf(profile);
    const last = list[list.length - 1];
    if (last !== undefined && last.url === url) {
        last.ts = Date.now(); // 同 URL 重载:刷新时间戳
        return last;
    }
    const entry = { url, title: "", ts: Date.now() };
    list.push(entry);
    if (list.length > 50)
        list.shift();
    return entry;
}
export function attachPage(page, config) {
    const timeoutMs = config.timeoutMs ?? 30000;
    page.setDefaultTimeout(timeoutMs);
    page.on("download", (download) => {
        const list = downloadsOf(currentProfile);
        list.push({ download, suggestedFilename: download.suggestedFilename(), at: Date.now() });
        if (list.length > 20)
            list.shift();
    });
    // 访问历史:记录主 frame 导航,load 后异步补齐标题。
    const profile = currentProfile;
    page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame())
            return;
        // 导航后旧 ref 全部失效(元素可能已不存在),防 ref 漂移误点。
        clearPageRefs(page);
        const url = frame.url();
        if (!url || url === "about:blank")
            return;
        recordNav(profile, url);
    });
    page.on("load", () => {
        const list = historyOf(profile);
        const entry = list[list.length - 1];
        if (entry === undefined)
            return;
        page
            .title()
            .then((t) => {
            if (t)
                entry.title = t;
        })
            .catch(() => { });
    });
    // 网络记录:只跟踪 XHR/fetch 接口请求(测试断言用),按 profile 隔离。
    // recordBodies 开启时记录请求体/响应体(截断;SSE 流与超大响应跳过)。
    const recordBodies = config.recordBodies !== false;
    const pendingReqs = new WeakMap();
    page.on("request", (req) => {
        if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch")
            return;
        let postData = null;
        if (recordBodies) {
            try {
                const raw = req.postData();
                if (raw)
                    postData = raw.length > 2000 ? `${raw.slice(0, 2000)}…(截断)` : raw;
            }
            catch {
                /* 读取失败忽略 */
            }
        }
        pendingReqs.set(req, { url: req.url(), method: req.method(), startedAt: Date.now(), postData });
    });
    page.on("response", async (res) => {
        const req = res.request();
        if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch")
            return;
        const info = pendingReqs.get(req);
        if (info === undefined)
            return;
        let body = null;
        if (recordBodies) {
            try {
                const headers = res.headers();
                const contentType = (headers["content-type"] ?? "").toLowerCase();
                const contentLength = Number(headers["content-length"] ?? 0);
                // 跳过 SSE 流(永不结束)与超大响应(>500KB),避免挂起/内存膨胀。
                if (!contentType.includes("text/event-stream") && !(contentLength > 500_000)) {
                    const text = await res.text();
                    if (text)
                        body = text.length > 4000 ? `${text.slice(0, 4000)}…(截断)` : text;
                }
            }
            catch {
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
        if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch")
            return;
        const info = pendingReqs.get(req);
        if (info === undefined)
            return;
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
        .exposeBinding(HUMAN_BINDING, (_source, payload) => {
        handleHumanEvent(payload);
        return null;
    })
        .then(() => page.addInitScript(installHumanRecorder))
        .then(() => page.evaluate(installHumanRecorder).catch(() => { })) // 已加载的当前文档也装上
        .catch(() => {
        /* 绑定已存在或页面已关闭:忽略 */
    });
}
export async function loadPlaywright() {
    try {
        return await import("playwright-core");
    }
    catch {
        throw new Error("dsh-browser: playwright-core is not installed. Run `dsh plugin --profile web add playwright-core` or install it in the profile.");
    }
}
export async function launchProfile(name, config) {
    const pw = await loadPlaywright();
    const state = getProfileState(name);
    const resolved = profileConfig(config, name);
    const base = { headless: resolved.headless ?? false };
    const candidates = [];
    if (resolved.executablePath) {
        candidates.push({ ...base, executablePath: resolved.executablePath });
    }
    else if (resolved.channel && resolved.channel !== "auto") {
        candidates.push({ ...base, channel: resolved.channel });
    }
    else {
        const order = process.platform === "win32"
            ? ["msedge", "chrome", "chromium"]
            : ["chrome", "msedge", "chromium"];
        for (const channel of order)
            candidates.push({ ...base, channel });
        candidates.push(base); // playwright's own bundled chromium fallback
    }
    let lastError;
    for (const options of candidates) {
        try {
            if (resolved.userDataDir) {
                // 持久化配置文件目录:登录态(Cookie/localStorage)跨重启保留
                const context = await pw.chromium.launchPersistentContext(resolved.userDataDir, {
                    ...options,
                    headless: resolved.headless ?? false,
                });
                for (const existing of context.pages()) {
                    existing.close().catch(() => { });
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
        }
        catch (error) {
            lastError = error;
        }
    }
    throw new Error(`dsh-browser: could not launch a Chromium-based browser. ` +
        `Install one, set config executablePath, or run \`npx playwright install chromium\`. ` +
        `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
/** 当前 profile 状态(未启动时创建空状态)。 */
export function stateOf() {
    return getProfileState(currentProfile);
}
const namedContexts = new Map();
export function namedContextsOf() {
    return namedContexts;
}
/** 把一个已 attach 的页面注册进 profile 标签表并激活,返回分配的 tab id。 */
export function registerTabPage(state, page) {
    const id = state.counter++;
    state.pages.set(id, page);
    state.activeId = id;
    return id;
}
/** 新建一个页面(当前 profile 会话未启动时先启动)。 */
export async function newPage(config) {
    const state = stateOf();
    const resolved = profileConfig(config, currentProfile);
    if (state.browser === null && state.context === null)
        await launchProfile(currentProfile, config);
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
export async function getPage(config) {
    const state = stateOf();
    if (state.browser === null && state.context === null)
        await launchProfile(currentProfile, config);
    if (state.pages.size === 0) {
        const page = await newPage(config);
        const id = state.counter++;
        state.pages.set(id, page);
        state.activeId = id;
    }
    const page = state.pages.get(state.activeId ?? -1);
    if (page === undefined)
        throw new Error("dsh-browser: no active page");
    return page;
}
/** 活动页面(可能为 null,不触发启动)。 */
export function activePage() {
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
        }
        catch {
            /* closed */
        }
        tabs.push({ id, url: page.url(), title });
    }
    return tabs;
}
export async function closeBrowser() {
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
            }
            else if (browser !== null) {
                await browser.close();
            }
        }
        catch {
            /* already closed */
        }
        void name;
    }
    profileStates.clear();
    downloadsByProfile.clear();
}
/** Best-effort current page identity, safe when nothing is open.title 有界防页面忙时挂起。 */
export async function pageIdentity(page) {
    try {
        const title = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("title timeout")), 2_000);
            page.title().then(resolve, reject).finally(() => clearTimeout(t));
        }).catch(() => "");
        return { url: page.url(), title };
    }
    catch {
        return { url: "", title: "" };
    }
}
/** 设置最近一次表单填充(供 browser_form_save 无参保存)。 */
export function setLastFormFields(fields) {
    lastFormFields = fields;
}
/** 切换当前 profile。 */
export function setCurrentProfile(name) {
    currentProfile = name;
}
// ---------------------------------------------------------------------------
// 截图清理:每次截图后懒清理 + 每小时定时清扫(只删该目录下的 .png)
// ---------------------------------------------------------------------------
/** 最近一次 browser_screenshot 实际写入的目录(供定时清扫复用,避免相对路径解析漂移)。 */
let lastScreenshotDir = null;
/** 记录最近一次截图目录(截图工具调用时写入)。 */
export function noteScreenshotDir(dir) {
    lastScreenshotDir = dir;
}
/** 定时清扫入口:若已知截图目录则按当前配置清理。 */
export function sweepScreenshotDir(opts) {
    if (lastScreenshotDir === null)
        return 0;
    return cleanupScreenshots(lastScreenshotDir, opts);
}
/**
 * 清理截图目录里的 .png 文件:按修改时间保留最新的 maxCount 个,
 * 并删除超过 maxAgeDays 天的旧文件。只处理目录直属文件,不递归;
 * 单个文件删除失败(被占用等)静默跳过。返回删除数量。
 */
export function cleanupScreenshots(dir, opts) {
    const maxAgeDays = Number(opts.maxAgeDays ?? 0) || 0;
    const maxCount = Math.max(0, Number(opts.maxCount ?? 0) || 0);
    if (maxAgeDays <= 0 && maxCount <= 0)
        return 0;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return 0; // 目录不存在
    }
    const now = Date.now();
    const cutoff = maxAgeDays > 0 ? now - maxAgeDays * 86_400_000 : 0;
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        if (!/\.png$/i.test(entry.name))
            continue;
        let mtimeMs = 0;
        try {
            mtimeMs = statSync(join(dir, entry.name)).mtimeMs;
        }
        catch {
            continue;
        }
        files.push({ name: entry.name, mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs); // 最新在前
    let removed = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const tooOld = cutoff > 0 && file.mtimeMs < cutoff;
        const tooMany = maxCount > 0 && i >= maxCount;
        if (!tooOld && !tooMany)
            continue;
        try {
            rmSync(join(dir, file.name), { force: true });
            removed++;
        }
        catch {
            /* 被占用等,跳过 */
        }
    }
    return removed;
}
//# sourceMappingURL=session.js.map