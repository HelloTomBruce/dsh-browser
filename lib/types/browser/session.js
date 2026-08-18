// dsh-browser · 浏览器 — 会话与标签页管理(多 profile、userDataDir 持久化、下载记录、访问历史、截图清理)
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
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
/** 已保存的录制脚本:name → 步骤数组。 */
export const savedRecordings = new Map();
/** 当前录制中的 buffer(非空 = 录制中)。 */
let recordingSteps = null;
/** 操作轨迹(全局,记录 currentProfile;上限 500 条)。 */
const testLog = [];
export function isRecording() {
    return recordingSteps !== null;
}
export function startRecording() {
    recordingSteps = [];
}
export function stopRecording() {
    const steps = recordingSteps ?? [];
    recordingSteps = null;
    return steps;
}
/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。 */
export function recordCall(call) {
    testLog.push(call);
    if (testLog.length > 500)
        testLog.shift();
    if (recordingSteps !== null && call.tool !== "browser_record" && call.tool !== "browser_replay") {
        recordingSteps.push(call);
        if (recordingSteps.length > 500)
            recordingSteps.shift();
    }
}
/** 操作轨迹(按时间倒序,最新在前)。 */
export function testLogOf() {
    return [...testLog].reverse();
}
export function clearTestLog() {
    testLog.length = 0;
}
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
/** Best-effort current page identity, safe when nothing is open. */
export async function pageIdentity(page) {
    try {
        return {
            url: page.url(),
            title: await page.title(),
        };
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