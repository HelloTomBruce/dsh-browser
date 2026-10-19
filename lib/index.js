import { dirname, isAbsolute, join, resolve } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
//#region lib/types/lib/config.js
function typeOf(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}
function checkField(key, value, schema, errors) {
	if (value === void 0 || value === null) {
		if (!schema.optional) errors.push(`config.${key}: 必填但缺失`);
		return;
	}
	const t = typeOf(value);
	if (schema.type === "any") return;
	if (schema.type === "string[]") {
		if (t !== "array" || !value.every((v) => typeof v === "string")) errors.push(`config.${key}: 期望 string[] 实际 ${t}`);
		return;
	}
	if (t !== schema.type) {
		errors.push(`config.${key}: 期望 ${schema.type} 实际 ${t}`);
		return;
	}
	if (schema.type === "number") {
		const n = value;
		if (schema.max !== void 0 && n > schema.max) errors.push(`config.${key}: 超过上限 ${schema.max}`);
		if (schema.min !== void 0 && n < schema.min) errors.push(`config.${key}: 低于下限 ${schema.min}`);
	}
	if (schema.type === "string" && schema.enum !== void 0 && !schema.enum.includes(value)) errors.push(`config.${key}: 必须是 ${schema.enum.join(" / ")} 之一`);
}
/** 校验配置;返回错误列表(空 = 通过)。 */
function validateConfig(schema, config) {
	const errors = [];
	for (const [key, field] of Object.entries(schema)) checkField(key, config[key], field, errors);
	return errors;
}
/** 合并默认值 + 校验;抛错时带模块名前缀。 */
function resolveConfig(moduleName, schema, defaults, raw) {
	const config = {
		...defaults,
		...raw ?? {}
	};
	for (const [key, field] of Object.entries(schema)) if (field.default !== void 0 && config[key] === void 0) config[key] = field.default;
	const errors = validateConfig(schema, config);
	if (errors.length > 0) throw new Error(`${moduleName}: 配置无效 — ${errors.join("; ")}`);
	return config;
}
//#endregion
//#region lib/types/lib/http.js
/** Parse the request URL pathname (query strings are ignored). */
function urlPath(req) {
	try {
		return new URL(req.url ?? "/", "http://x").pathname;
	} catch {
		return "/";
	}
}
/** Read the request body as a UTF-8 string (bounded). */
function readRawBody(req, limitBytes = 1e6) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limitBytes) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}
/** Read and parse a JSON request body; `undefined` when the body is empty. */
async function readJsonBody(req, limitBytes) {
	const raw = await readRawBody(req, limitBytes);
	if (!raw) return void 0;
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
	}
}
/** Send a JSON response. */
function sendJson(res, status, value, extraHeaders = {}) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		...extraHeaders
	});
	res.end(body);
}
/** Send a plain text response. */
function sendText(res, status, text, headers = {}) {
	res.writeHead(status, {
		"content-type": "text/plain; charset=utf-8",
		"content-length": Buffer.byteLength(text),
		...headers
	});
	res.end(text);
}
//#endregion
//#region lib/types/lib/tools.js
/** 可选的诊断日志(由 registerTools 注入 ctx.logger;未注入时静默)。 */
let logFn = null;
let cwdLogged = false;
/** 注入日志函数(插件 apply 时调用一次)。 */
function setToolsLogger(fn) {
	logFn = fn;
}
/**
* Resolve the workspace working directory for one tool execution.
* Prefers the calling agent's session cwd; falls back to the host process cwd.
*/
function workspaceCwd(exec) {
	try {
		const cwd = exec?.agent?.session?.meta?.cwd;
		if (typeof cwd === "string" && cwd.length > 0) return cwd;
	} catch {}
	try {
		const cwd = exec?.cwd;
		if (typeof cwd === "string" && cwd.length > 0) return cwd;
	} catch {}
	return process.cwd();
}
/**
* 截图/下载/上传等文件的落盘基准目录:
*   1. config.workspaceDir 显式指定(相对路径按 process.cwd() 解析)——最高优先;
*   2. 会话 cwd 探测链(workspaceCwd);
* 首次解析打一次日志,记录来源,便于诊断「文件落错位置」类问题。
*/
function workspaceBaseDir(config, exec) {
	const explicit = config.workspaceDir;
	if (typeof explicit === "string" && explicit.length > 0) {
		const dir = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
		if (!cwdLogged) {
			cwdLogged = true;
			logFn?.(`dsh-browser: 工作目录基准 = ${dir} (来源: config.workspaceDir)`);
		}
		return dir;
	}
	const dir = workspaceCwd(exec);
	if (!cwdLogged) {
		cwdLogged = true;
		const fromSession = (() => {
			try {
				return typeof exec?.agent?.session?.meta?.cwd === "string" && exec.agent.session.meta.cwd.length > 0;
			} catch {
				return false;
			}
		})();
		logFn?.(`dsh-browser: 工作目录基准 = ${dir} (来源: ${fromSession ? "session.meta.cwd" : "process.cwd"})`);
	}
	return dir;
}
/**
* Build a plain ToolDefinition for `ctx.tools.register` without depending on
* any @deepseek-ai package (max version-alignment tolerance).
*/
function definePlainTool(options) {
	const render = options.render ?? ((_args, value) => JSON.stringify(value, null, 2));
	const definition = {
		name: options.name,
		description: options.description,
		parameters: options.parameters,
		output: {
			schema: options.outputSchema ?? { type: "object" },
			render: (args, value) => [{
				type: "text",
				text: render(args, value)
			}]
		},
		execute: options.execute
	};
	if (options.presentCall !== void 0) definition.presentCall = options.presentCall;
	if (options.concurrencySafe) definition.isConcurrencySafe = () => true;
	if (options.timeoutMs !== void 0) definition.timeoutMs = options.timeoutMs;
	return definition;
}
/** Generic card view used by all dsh-browser tools. */
function genericCard(kind, title, rawInput) {
	return {
		card: "generic",
		kind,
		title,
		rawInput
	};
}
//#endregion
//#region lib/types/browser/session.js
/** 当前活动 profile 名(默认 "default")。 */
let currentProfile = "default";
/** 多配置文件浏览器会话:name → 会话状态。 */
const profileStates = /* @__PURE__ */ new Map();
/** 最近下载记录 [{ download, suggestedFilename, at }](按 profile 名隔离)。 */
const downloadsByProfile = /* @__PURE__ */ new Map();
/** 页面访问历史(按 profile 名隔离)。不随 closeBrowser 清空,DSH 重启才重置。 */
const historyByProfile = /* @__PURE__ */ new Map();
/** 已保存的表单回放:name → fields 数组。 */
const savedForms = /* @__PURE__ */ new Map();
/** 最近一次 browser_form 填充的字段(供 browser_form_save 无参保存)。 */
let lastFormFields = [];
const refRegistry = /* @__PURE__ */ new WeakMap();
/** 记录一次 aria 快照分配的 ref(整表替换)。 */
function setPageRefs(page, refs) {
	refRegistry.set(page, refs);
}
/** 查询某个 ref 的定位信息;未注册返回 undefined。 */
function pageRef(page, ref) {
	return refRegistry.get(page)?.get(ref);
}
/** 清空页面的 ref 表(导航/新快照时调用)。 */
function clearPageRefs(page) {
	refRegistry.delete(page);
}
/** 已保存的录制脚本:name → 步骤数组。 */
const savedRecordings = /* @__PURE__ */ new Map();
/** 当前录制中的 buffer(非空 = 录制中)。 */
let recordingSteps = null;
/** 最近一次 start→stop 的录制结果(save 优先使用;下次 start 时覆盖)。 */
let lastRecording = null;
/** 操作轨迹(全局,记录 currentProfile;上限 500 条)。 */
const testLog = [];
function isRecording() {
	return recordingSteps !== null;
}
function startRecording() {
	lastRecording = null;
	recordingSteps = [];
}
function stopRecording() {
	const steps = recordingSteps ?? [];
	recordingSteps = null;
	lastRecording = steps;
	return steps;
}
/** 最近一次完整录制(start→stop)的 buffer;从未录制过返回 null。 */
function lastRecordingOf() {
	return lastRecording;
}
/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。返回存入的调用对象(供调用方补 meta)。 */
function recordCall(call) {
	testLog.push(call);
	if (testLog.length > 500) testLog.shift();
	if (recordingSteps !== null && call.tool !== "browser_record" && call.tool !== "browser_replay") {
		recordingSteps.push(call);
		if (recordingSteps.length > 500) recordingSteps.shift();
	}
	return call;
}
/** 操作轨迹(按时间倒序,最新在前)。 */
function testLogOf() {
	return [...testLog].reverse();
}
const networkByProfile = /* @__PURE__ */ new Map();
function networkOf(name) {
	let list = networkByProfile.get(name);
	if (list === void 0) {
		list = [];
		networkByProfile.set(name, list);
	}
	return list;
}
function networkEntries(name) {
	return networkOf(name);
}
function addNetworkEntry(profile, entry) {
	const list = networkOf(profile);
	list.push(entry);
	if (list.length > 500) list.shift();
}
function clearNetwork(profile) {
	networkByProfile.delete(profile);
}
function profileConfig(config, name) {
	const named = config.profiles?.[name];
	if (!named || typeof named !== "object") return { ...config };
	return {
		...config,
		...named,
		profiles: config.profiles
	};
}
function getProfileState(name) {
	let state = profileStates.get(name);
	if (state === void 0) {
		state = {
			browser: null,
			context: null,
			persistent: false,
			pages: /* @__PURE__ */ new Map(),
			activeId: null,
			counter: 0
		};
		profileStates.set(name, state);
	}
	return state;
}
function downloadsOf(name) {
	let list = downloadsByProfile.get(name);
	if (list === void 0) {
		list = [];
		downloadsByProfile.set(name, list);
	}
	return list;
}
/** 某 profile 的访问历史(按时间先后)。 */
function historyOf(name) {
	let list = historyByProfile.get(name);
	if (list === void 0) {
		list = [];
		historyByProfile.set(name, list);
	}
	return list;
}
/** 把一次主 frame 导航记入该 profile 的访问历史(去重 + 上限 50 条)。 */
function recordNav(profile, url) {
	const list = historyOf(profile);
	const last = list[list.length - 1];
	if (last !== void 0 && last.url === url) {
		last.ts = Date.now();
		return last;
	}
	const entry = {
		url,
		title: "",
		ts: Date.now()
	};
	list.push(entry);
	if (list.length > 50) list.shift();
	return entry;
}
function attachPage(page, config) {
	const timeoutMs = config.timeoutMs ?? 3e4;
	page.setDefaultTimeout(timeoutMs);
	page.on("download", (download) => {
		const list = downloadsOf(currentProfile);
		list.push({
			download,
			suggestedFilename: download.suggestedFilename(),
			at: Date.now()
		});
		if (list.length > 20) list.shift();
	});
	const profile = currentProfile;
	page.on("framenavigated", (frame) => {
		if (frame !== page.mainFrame()) return;
		clearPageRefs(page);
		const url = frame.url();
		if (!url || url === "about:blank") return;
		recordNav(profile, url);
	});
	page.on("load", () => {
		const list = historyOf(profile);
		const entry = list[list.length - 1];
		if (entry === void 0) return;
		page.title().then((t) => {
			if (t) entry.title = t;
		}).catch(() => {});
	});
	const recordBodies = config.recordBodies !== false;
	const pendingReqs = /* @__PURE__ */ new WeakMap();
	page.on("request", (req) => {
		if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
		let postData = null;
		if (recordBodies) try {
			const raw = req.postData();
			if (raw) postData = raw.length > 2e3 ? `${raw.slice(0, 2e3)}…(截断)` : raw;
		} catch {}
		pendingReqs.set(req, {
			url: req.url(),
			method: req.method(),
			startedAt: Date.now(),
			postData
		});
	});
	page.on("response", async (res) => {
		const req = res.request();
		if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
		const info = pendingReqs.get(req);
		if (info === void 0) return;
		let body = null;
		if (recordBodies) try {
			const headers = res.headers();
			const contentType = (headers["content-type"] ?? "").toLowerCase();
			const contentLength = Number(headers["content-length"] ?? 0);
			if (!contentType.includes("text/event-stream") && !(contentLength > 5e5)) {
				const text = await res.text();
				if (text) body = text.length > 4e3 ? `${text.slice(0, 4e3)}…(截断)` : text;
			}
		} catch {}
		addNetworkEntry(profile, {
			url: res.url(),
			method: info.method,
			resourceType: req.resourceType(),
			status: res.status(),
			ok: res.ok(),
			startedAt: info.startedAt,
			durationMs: Date.now() - info.startedAt,
			postData: info.postData,
			body
		});
	});
	page.on("requestfailed", (req) => {
		if (req.resourceType() !== "xhr" && req.resourceType() !== "fetch") return;
		const info = pendingReqs.get(req);
		if (info === void 0) return;
		addNetworkEntry(profile, {
			url: req.url(),
			method: info.method,
			resourceType: req.resourceType(),
			failed: true,
			error: req.failure()?.errorText ?? "failed",
			startedAt: info.startedAt,
			durationMs: Date.now() - info.startedAt
		});
	});
}
async function loadPlaywright() {
	try {
		return await import("playwright-core");
	} catch {
		throw new Error("dsh-browser: playwright-core is not installed. Run `dsh plugin --profile web add playwright-core` or install it in the profile.");
	}
}
async function launchProfile(name, config) {
	const pw = await loadPlaywright();
	const state = getProfileState(name);
	const resolved = profileConfig(config, name);
	const base = { headless: resolved.headless ?? false };
	const candidates = [];
	if (resolved.executablePath) candidates.push({
		...base,
		executablePath: resolved.executablePath
	});
	else if (resolved.channel && resolved.channel !== "auto") candidates.push({
		...base,
		channel: resolved.channel
	});
	else {
		const order = process.platform === "win32" ? [
			"msedge",
			"chrome",
			"chromium"
		] : [
			"chrome",
			"msedge",
			"chromium"
		];
		for (const channel of order) candidates.push({
			...base,
			channel
		});
		candidates.push(base);
	}
	let lastError;
	for (const options of candidates) try {
		if (resolved.userDataDir) {
			const context = await pw.chromium.launchPersistentContext(resolved.userDataDir, {
				...options,
				headless: resolved.headless ?? false
			});
			for (const existing of context.pages()) existing.close().catch(() => {});
			state.browser = null;
			state.context = context;
			state.persistent = true;
			state.channel = options.channel ?? options.executablePath ?? "bundled";
			return;
		}
		state.browser = await pw.chromium.launch(options);
		state.context = null;
		state.persistent = false;
		state.channel = options.channel ?? options.executablePath ?? "bundled";
		return;
	} catch (error) {
		lastError = error;
	}
	throw new Error(`dsh-browser: could not launch a Chromium-based browser. Install one, set config executablePath, or run \`npx playwright install chromium\`. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
/** 当前 profile 状态(未启动时创建空状态)。 */
function stateOf() {
	return getProfileState(currentProfile);
}
/** 新建一个页面(当前 profile 会话未启动时先启动)。 */
async function newPage(config) {
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
async function getPage(config) {
	const state = stateOf();
	if (state.browser === null && state.context === null) await launchProfile(currentProfile, config);
	if (state.pages.size === 0) {
		const page = await newPage(config);
		const id = state.counter++;
		state.pages.set(id, page);
		state.activeId = id;
	}
	const page = state.pages.get(state.activeId ?? -1);
	if (page === void 0) throw new Error("dsh-browser: no active page");
	return page;
}
/** 活动页面(可能为 null,不触发启动)。 */
function activePage() {
	const state = stateOf();
	return state.pages.get(state.activeId ?? -1) ?? null;
}
/** 投影当前 profile 的标签列表。 */
async function tabList() {
	const state = stateOf();
	const tabs = [];
	for (const [id, page] of state.pages) {
		let title = "";
		try {
			title = await page.title();
		} catch {}
		tabs.push({
			id,
			url: page.url(),
			title
		});
	}
	return tabs;
}
async function closeBrowser() {
	for (const [name, state] of profileStates) {
		const { browser, context } = state;
		state.browser = null;
		state.context = null;
		state.pages = /* @__PURE__ */ new Map();
		state.activeId = null;
		state.counter = 0;
		try {
			if (context !== null) await context.close();
			else if (browser !== null) await browser.close();
		} catch {}
	}
	profileStates.clear();
	downloadsByProfile.clear();
}
/** Best-effort current page identity, safe when nothing is open. */
async function pageIdentity(page) {
	try {
		return {
			url: page.url(),
			title: await page.title()
		};
	} catch {
		return {
			url: "",
			title: ""
		};
	}
}
/** 设置最近一次表单填充(供 browser_form_save 无参保存)。 */
function setLastFormFields(fields) {
	lastFormFields = fields;
}
/** 切换当前 profile。 */
function setCurrentProfile(name) {
	currentProfile = name;
}
/** 最近一次 browser_screenshot 实际写入的目录(供定时清扫复用,避免相对路径解析漂移)。 */
let lastScreenshotDir = null;
/** 记录最近一次截图目录(截图工具调用时写入)。 */
function noteScreenshotDir(dir) {
	lastScreenshotDir = dir;
}
/** 定时清扫入口:若已知截图目录则按当前配置清理。 */
function sweepScreenshotDir(opts) {
	if (lastScreenshotDir === null) return 0;
	return cleanupScreenshots(lastScreenshotDir, opts);
}
/**
* 清理截图目录里的 .png 文件:按修改时间保留最新的 maxCount 个,
* 并删除超过 maxAgeDays 天的旧文件。只处理目录直属文件,不递归;
* 单个文件删除失败(被占用等)静默跳过。返回删除数量。
*/
function cleanupScreenshots(dir, opts) {
	const maxAgeDays = Number(opts.maxAgeDays ?? 0) || 0;
	const maxCount = Math.max(0, Number(opts.maxCount ?? 0) || 0);
	if (maxAgeDays <= 0 && maxCount <= 0) return 0;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 864e5 : 0;
	const files = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (!/\.png$/i.test(entry.name)) continue;
		let mtimeMs = 0;
		try {
			mtimeMs = statSync(join(dir, entry.name)).mtimeMs;
		} catch {
			continue;
		}
		files.push({
			name: entry.name,
			mtimeMs
		});
	}
	files.sort((a, b) => b.mtimeMs - a.mtimeMs);
	let removed = 0;
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!(cutoff > 0 && file.mtimeMs < cutoff) && !(maxCount > 0 && i >= maxCount)) continue;
		try {
			rmSync(join(dir, file.name), { force: true });
			removed++;
		} catch {}
	}
	return removed;
}
//#endregion
//#region lib/types/browser/recordings.js
/** 录制存储目录($DSH_HOME/.dsh-browser/recordings)。 */
function recordingsDir() {
	const home = process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(home, ".dsh-browser", "recordings");
}
/** 名字安全化:只保留字母数字 . _ -,连续点压成下划线防路径穿越。 */
function safeName(name) {
	return name.replace(/\.\./g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
}
/** 加载目录下所有 .json 录制进内存表;返回加载数量。坏文件静默跳过。 */
function loadRecordings() {
	const dir = recordingsDir();
	let loaded = 0;
	try {
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
				if (data !== null && typeof data === "object" && Array.isArray(data.steps)) {
					savedRecordings.set(file.slice(0, -5), {
						steps: data.steps,
						savedAt: typeof data.savedAt === "number" ? data.savedAt : Date.now()
					});
					loaded++;
				}
			} catch {}
		}
	} catch {}
	return loaded;
}
/** 写一个录制到磁盘(原子替换);返回文件路径。formatVersion 2 起步骤可带 meta(选择器指纹)与 {{var}} 占位符。 */
function saveRecordingFile(name, steps) {
	const dir = recordingsDir();
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${safeName(name)}.json`);
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, JSON.stringify({
		formatVersion: 2,
		steps,
		savedAt: Date.now()
	}, null, 2));
	renameSync(tmp, file);
	return file;
}
/** 删除磁盘上的录制文件;返回是否存在并删除。 */
function deleteRecordingFile(name) {
	const file = join(recordingsDir(), `${safeName(name)}.json`);
	try {
		rmSync(file, { force: true });
		return true;
	} catch {
		return false;
	}
}
/** 录制列表(面板 / browser_record list 共用)。 */
function listRecordings() {
	return [...savedRecordings.entries()].map(([name, r]) => ({
		name,
		steps: r.steps.length,
		savedAt: r.savedAt,
		preview: r.steps.slice(0, 3).map((s) => s.tool).join(", ")
	}));
}
/** 录制详情(面板展开查看步骤)。 */
function recordingDetail(name) {
	const r = savedRecordings.get(name);
	if (r === void 0) return void 0;
	return {
		name,
		steps: r.steps
	};
}
/** 删除录制(内存 + 磁盘同步);返回是否存在并删除。 */
function deleteRecording(name) {
	const existed = savedRecordings.delete(name);
	if (existed) deleteRecordingFile(name);
	return existed;
}
//#endregion
//#region lib/types/browser/extract.js
/** 把一行里的值转成 CSV 单元格文本(引号双写转义,对象 JSON 化)。 */
function csvCell(value) {
	if (value === null || value === void 0) return "";
	const s = typeof value === "string" ? value : JSON.stringify(value);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}
/** 行的表头:所有行 key 的并集(按首次出现顺序)。 */
function headerOf(rows) {
	const keys = [];
	for (const row of rows) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
	return keys;
}
function toCsv(rows) {
	const header = headerOf(rows);
	const lines = [header.map(csvCell).join(",")];
	for (const row of rows) lines.push(header.map((k) => csvCell(row[k])).join(","));
	return lines.join("\n") + "\n";
}
function toJsonl(rows) {
	return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}
function toMarkdownTable(rows) {
	const header = headerOf(rows);
	if (header.length === 0) return "(空)\n";
	const cell = (v) => {
		if (v === null || v === void 0) return "";
		return (typeof v === "string" ? v : JSON.stringify(v)).replace(/\|/g, "\\|").replace(/\n/g, " ");
	};
	return [
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((r) => `| ${header.map((k) => cell(r[k])).join(" | ")} |`)
	].join("\n") + "\n";
}
/** 按格式序列化抽取结果(json 为 pretty JSON 字符串)。 */
function serializeRows(rows, format) {
	if (format === "csv") return toCsv(rows);
	if (format === "jsonl") return toJsonl(rows);
	if (format === "markdown") return toMarkdownTable(rows);
	return JSON.stringify(rows, null, 2) + "\n";
}
/** 由文件扩展名推断序列化格式(显式 format 优先)。 */
function formatFromFile(file) {
	if (/\.csv$/i.test(file)) return "csv";
	if (/\.jsonl$/i.test(file)) return "jsonl";
	if (/\.(md|markdown)$/i.test(file)) return "markdown";
	if (/\.json$/i.test(file)) return "json";
	return null;
}
/**
* 解析 CSV 文本为行对象数组(首行为表头;支持引号包裹、双引号转义、
* 逗号/换行内嵌)。供 browser_replay 的 dataFile 使用。
*/
function parseCsv(text) {
	const rows = [];
	let cur = [];
	let field = "";
	let inQuotes = false;
	let i = 0;
	const pushField = () => {
		cur.push(field);
		field = "";
	};
	const pushRow = () => {
		pushField();
		rows.push(cur);
		cur = [];
	};
	while (i < text.length) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === "\"") {
				if (text[i + 1] === "\"") {
					field += "\"";
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === "\"") {
			inQuotes = true;
			i++;
			continue;
		}
		if (ch === ",") {
			pushField();
			i++;
			continue;
		}
		if (ch === "\r") {
			i++;
			continue;
		}
		if (ch === "\n") {
			pushRow();
			i++;
			continue;
		}
		field += ch;
		i++;
	}
	if (field !== "" || cur.length > 0) pushRow();
	const header = rows[0]?.map((h) => h.trim()) ?? [];
	const out = [];
	for (let r = 1; r < rows.length; r++) {
		const cells = rows[r];
		if (cells.length === 1 && cells[0] === "") continue;
		const obj = {};
		header.forEach((h, c) => {
			obj[h] = cells[c] ?? "";
		});
		out.push(obj);
	}
	return out;
}
//#endregion
//#region lib/types/browser/reports.js
/** 报告存储目录($DSH_HOME/.dsh-browser/reports)。 */
function reportsDir() {
	const home = process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(home, ".dsh-browser", "reports");
}
function runsFile() {
	return join(reportsDir(), "runs.jsonl");
}
/** 生成 runId:YYYYMMDD-HHmmss-随机4位。 */
function makeRunId(ts) {
	const d = new Date(ts);
	const pad = (n) => String(n).padStart(2, "0");
	return `${`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`}-${Math.random().toString(36).slice(2, 6)}`;
}
const MAX_LINES = 1e3;
const MAX_BYTES = 5242880;
/** 追加一条运行记录;超限时截断旧行(原子替换)。 */
function appendRun(record) {
	const dir = reportsDir();
	mkdirSync(dir, { recursive: true });
	const file = runsFile();
	appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
	let size = 0;
	try {
		size = statSync(file).size;
	} catch {
		return;
	}
	if (size <= MAX_BYTES) {
		try {
			const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
			if (lines.length <= MAX_LINES) return;
			const kept = lines.slice(-1e3).join("\n") + "\n";
			const tmp = `${file}.tmp`;
			writeFileSync(tmp, kept, "utf8");
			renameSync(tmp, file);
		} catch {}
		return;
	}
	try {
		const kept = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").slice(-1e3).join("\n") + "\n";
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, kept, "utf8");
		renameSync(tmp, file);
	} catch {}
}
/** 读取全部运行记录(按时间倒序);坏行静默跳过。 */
function listRuns(limit = 50) {
	let lines = [];
	try {
		lines = readFileSync(runsFile(), "utf8").split("\n").filter((l) => l.trim() !== "");
	} catch {
		return [];
	}
	const runs = [];
	for (let i = lines.length - 1; i >= 0 && runs.length < limit; i--) try {
		const r = JSON.parse(lines[i]);
		if (r !== null && typeof r === "object" && typeof r.runId === "string") runs.push(r);
	} catch {}
	return runs;
}
/** 最近一次运行(无记录返回 null)。 */
function latestRun() {
	return listRuns(1)[0] ?? null;
}
/** 按 runId 取单条记录。 */
function getRun(runId) {
	return listRuns(MAX_LINES).find((r) => r.runId === runId) ?? null;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtTs = (ts) => new Date(ts).toLocaleString("zh-CN", { hour12: false });
/** 聚合统计:失败步骤 TopN 与自愈步骤清单(两个渲染器共用)。 */
function analyze(runs) {
	const failMap = /* @__PURE__ */ new Map();
	const healed = [];
	for (const run of runs) for (const step of run.results) if (!step.ok) {
		const key = `${run.source}|${step.tool}|${step.error ?? ""}`;
		const cur = failMap.get(key);
		if (cur !== void 0) cur.count++;
		else failMap.set(key, {
			source: run.source,
			tool: step.tool,
			error: step.error ?? "",
			count: 1
		});
	} else if (step.healed === true) healed.push({
		ts: run.ts,
		source: run.source,
		tool: step.tool,
		via: step.via ?? "",
		resolved: step.resolved ?? ""
	});
	return {
		failures: [...failMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
		healed
	};
}
/** 生成 Markdown 回归报告。 */
function renderMarkdownReport(runs, source) {
	const lines = [
		`# ${source !== void 0 && source !== "" ? `回归报告 — ${source}` : "回归报告 — 全部来源"}`,
		"",
		`> 生成时间:${fmtTs(Date.now())} · 共 ${runs.length} 次运行`,
		"",
		"## 运行趋势(最新在前)",
		"",
		"| 时间 | 来源 | 通过/总数 | 失败 | 自愈 | 耗时 |",
		"| --- | --- | --- | --- | --- | --- |"
	];
	for (const r of runs) lines.push(`| ${fmtTs(r.ts)} | ${r.source}${r.row !== void 0 ? ` (行${r.row})` : ""} | ${r.passed}/${r.total} | ${r.failed} | ${r.healedCount} | ${(r.durationMs / 1e3).toFixed(1)}s |`);
	const { failures, healed } = analyze(runs);
	lines.push("", "## 失败步骤 Top", "");
	if (failures.length === 0) lines.push("全部通过 🎉");
	else {
		lines.push("| 次数 | 来源 | 步骤 | 错误 |", "| --- | --- | --- | --- |");
		for (const f of failures) lines.push(`| ${f.count} | ${f.source} | ${f.tool} | ${f.error.slice(0, 120).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
	}
	if (healed.length > 0) {
		lines.push("", "## 自愈步骤(建议修复录制中的选择器)", "", "| 时间 | 来源 | 步骤 | 自愈方式 | 新选择器 |", "| --- | --- | --- | --- | --- |");
		for (const h of healed.slice(0, 20)) lines.push(`| ${fmtTs(h.ts)} | ${h.source} | ${h.tool} | ${h.via} | \`${h.resolved}\` |`);
	}
	lines.push("");
	return lines.join("\n");
}
/** 生成自包含 HTML 回归报告(内联样式,无外部资源)。 */
function renderHtmlReport(runs, source) {
	const title = source !== void 0 && source !== "" ? `回归报告 — ${source}` : "回归报告 — 全部来源";
	const { failures, healed } = analyze(runs);
	const rowHtml = runs.map((r) => {
		const ok = r.failed === 0;
		return `<tr><td>${esc(fmtTs(r.ts))}</td><td>${esc(r.source)}${r.row !== void 0 ? ` (行${r.row})` : ""}</td><td class="${ok ? "ok" : "bad"}">${r.passed}/${r.total}</td><td>${r.failed}</td><td>${r.healedCount}</td><td>${(r.durationMs / 1e3).toFixed(1)}s</td></tr>`;
	}).join("\n");
	const failRows = failures.length === 0 ? `<tr><td colspan="4" class="ok">全部通过 🎉</td></tr>` : failures.map((f) => `<tr><td>${f.count}</td><td>${esc(f.source)}</td><td>${esc(f.tool)}</td><td>${esc(f.error.slice(0, 200))}</td></tr>`).join("\n");
	const healRows = healed.slice(0, 20).map((h) => `<tr><td>${esc(fmtTs(h.ts))}</td><td>${esc(h.source)}</td><td>${esc(h.tool)}</td><td>${esc(h.via)}</td><td><code>${esc(h.resolved)}</code></td></tr>`).join("\n");
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2933}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #d9e2ec;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f0f4f8}.ok{color:#0f9d58;font-weight:600}.bad{color:#d64545;font-weight:600}
code{background:#f0f4f8;padding:1px 4px;border-radius:4px;font-size:12px}
.meta{color:#7b8794;font-size:13px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">生成时间:${esc(fmtTs(Date.now()))} · 共 ${runs.length} 次运行</p>
<h2>运行趋势(最新在前)</h2>
<table><thead><tr><th>时间</th><th>来源</th><th>通过/总数</th><th>失败</th><th>自愈</th><th>耗时</th></tr></thead>
<tbody>${rowHtml}</tbody></table>
<h2>失败步骤 Top</h2>
<table><thead><tr><th>次数</th><th>来源</th><th>步骤</th><th>错误</th></tr></thead>
<tbody>${failRows}</tbody></table>
${healRows !== "" ? `<h2>自愈步骤(建议修复录制中的选择器)</h2>
<table><thead><tr><th>时间</th><th>来源</th><th>步骤</th><th>自愈方式</th><th>新选择器</th></tr></thead>
<tbody>${healRows}</tbody></table>` : ""}
</body></html>
`;
}
//#endregion
//#region lib/types/browser/tools.js
/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
function pngSize(buf) {
	if (buf.length < 24 || buf.readUInt32BE(0) !== 2303741511) throw new Error("not a PNG file");
	return {
		width: buf.readUInt32BE(16),
		height: buf.readUInt32BE(20)
	};
}
/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
function scaleRects(rects, scale) {
	return rects.map((r) => ({
		x: Math.round(r.x * scale),
		y: Math.round(r.y * scale),
		width: Math.round(r.width * scale),
		height: Math.round(r.height * scale)
	}));
}
async function openTool(config, args) {
	const page = await getPage(config);
	await page.goto(String(args.url), {
		waitUntil: args.waitUntil ?? "domcontentloaded",
		timeout: args.timeoutMs ?? config.timeoutMs
	});
	return {
		url: page.url(),
		title: await page.title(),
		status: "ok"
	};
}
/**
* 快照文本压缩(导出供测试):
*   - 去掉首尾空白行;
*   - 连续空白行折叠为 1 行;
*   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
* 只折叠完全相同的相邻行,不重排、不删改非重复内容。
*/
function compressText(text) {
	const lines = text.split("\n");
	const out = [];
	let blankRun = 0;
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "") {
			blankRun++;
			if (blankRun === 1 && out.length > 0) out.push("");
			continue;
		}
		blankRun = 0;
		let dup = 0;
		while (i + dup + 1 < lines.length && lines[i + dup + 1].trim() === trimmed) dup++;
		out.push(lines[i]);
		if (dup > 0) {
			out.push(`…(重复 ${dup} 行)`);
			i += dup;
		}
	}
	while (out.length > 0 && out[out.length - 1] === "") out.pop();
	return out.join("\n");
}
/**
* 页内 ARIA 树构建(自包含函数,page.evaluate 序列化注入;禁止引用模块级变量)。
* 遍历 DOM:结构角色(navigation/main/form/table/heading…)直接打印;
* 可交互元素分配 ref=e1..eN 并附稳定 CSS 路径;无语义容器(div/span)穿透。
* 输出形如 `- button "登录" [ref=e3]` 的缩进树,供纯文本模型定位操作目标。
*/
function buildAriaTree(maxRefs) {
	const INTERACTIVE = /* @__PURE__ */ new Set([
		"link",
		"button",
		"textbox",
		"checkbox",
		"radio",
		"combobox",
		"listbox",
		"searchbox",
		"slider",
		"spinbutton",
		"switch",
		"tab",
		"menuitem",
		"option",
		"treeitem"
	]);
	const STRUCTURAL = /* @__PURE__ */ new Set([
		"navigation",
		"main",
		"banner",
		"contentinfo",
		"form",
		"search",
		"complementary",
		"region",
		"dialog",
		"alert",
		"table",
		"list",
		"heading",
		"toolbar",
		"menu",
		"menubar",
		"tablist",
		"tree",
		"grid"
	]);
	const SKIP_TAGS = /* @__PURE__ */ new Set([
		"script",
		"style",
		"template",
		"noscript",
		"svg",
		"path",
		"link",
		"meta",
		"br"
	]);
	function roleOf(el) {
		const explicit = el.getAttribute("role");
		if (explicit) return explicit.trim().split(/\s+/)[0] ?? "";
		switch (el.tagName.toLowerCase()) {
			case "a": return el.hasAttribute("href") ? "link" : "";
			case "button": return "button";
			case "input": {
				const t = (el.getAttribute("type") ?? "text").toLowerCase();
				if (t === "checkbox") return "checkbox";
				if (t === "radio") return "radio";
				if (t === "range") return "slider";
				if (t === "number") return "spinbutton";
				if (t === "search") return "searchbox";
				if ([
					"button",
					"submit",
					"reset",
					"image"
				].includes(t)) return "button";
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
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6": return "heading";
			case "ul":
			case "ol": return "list";
			case "li": return "listitem";
			case "table": return "table";
			case "dialog": return "dialog";
			case "summary": return "button";
			default: return "";
		}
	}
	function nameOf(el, role) {
		const aria = el.getAttribute("aria-label");
		if (aria && aria.trim()) return aria.trim().slice(0, 60);
		const labelledby = el.getAttribute("aria-labelledby");
		if (labelledby) {
			const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
			if (t) return t.slice(0, 60);
		}
		if (el.id) {
			const t = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim();
			if (t) return t.slice(0, 60);
		}
		if ([
			"textbox",
			"searchbox",
			"combobox",
			"spinbutton"
		].includes(role)) {
			const ph = el.getAttribute("placeholder");
			if (ph && ph.trim()) return ph.trim().slice(0, 60);
		}
		const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
		if (text) return text.slice(0, 60);
		const title = el.getAttribute("title");
		if (title && title.trim()) return title.trim().slice(0, 60);
		return "";
	}
	/** 稳定 CSS 路径:#id → [data-testid] → nth-of-type 链(≤6 层)。 */
	function cssPath(el) {
		if (el.id) return `#${CSS.escape(el.id)}`;
		const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
		if (testid) return `[data-testid="${testid.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"]`;
		const parts = [];
		let cur = el;
		while (cur && cur !== document.body && parts.length < 6) {
			const tag = cur.tagName.toLowerCase();
			const parent = cur.parentElement;
			if (!parent) {
				parts.unshift(tag);
				break;
			}
			const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
			const idx = sameTag.indexOf(cur) + 1;
			parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
			cur = parent;
		}
		return parts.join(" > ");
	}
	function isVisible(el) {
		if (el.getAttribute("aria-hidden") === "true") return false;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return false;
		const style = getComputedStyle(el);
		return style.visibility !== "hidden" && style.display !== "none";
	}
	const lines = [];
	const refs = [];
	let truncated = false;
	function walk(el, depth) {
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
			if (ref !== "") refs.push({
				ref,
				role,
				name,
				selector: cssPath(el)
			});
			const expanded = el.getAttribute("aria-expanded");
			const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true";
			lines.push(`${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${ref !== "" ? ` [ref=${ref}]` : ""}${expanded !== null ? ` [expanded=${expanded}]` : ""}${disabled ? " [disabled]" : ""}`);
			return;
		}
		if (STRUCTURAL.has(role)) {
			if (!isVisible(el)) return;
			const name = nameOf(el, role);
			const level = role === "heading" ? ` [level=${el.tagName[1] ?? "1"}]` : "";
			lines.push(`${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${level}`);
			for (const c of Array.from(el.children)) if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth + 1);
			return;
		}
		for (const c of Array.from(el.children)) if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth);
	}
	if (document.body) walk(document.body, 0);
	return {
		tree: lines.join("\n"),
		refs,
		truncated
	};
}
async function snapshotTool(config, args) {
	const page = await getPage(config);
	const maxText = args.maxTextChars ?? config.maxTextChars;
	if (args.mode === "aria") {
		const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
		const data = await page.evaluate(buildAriaTree, maxRefs);
		setPageRefs(page, new Map(data.refs.map((r) => [r.ref, {
			role: r.role,
			name: r.name,
			selector: r.selector
		}])));
		return {
			url: page.url(),
			title: await page.title(),
			tree: data.tree.slice(0, maxText),
			truncated: data.truncated || data.tree.length > maxText,
			refs: data.refs.length
		};
	}
	const maxLinks = args.maxLinks ?? config.maxLinks;
	const data = await page.evaluate(([maxT, maxL]) => {
		return {
			text: document.body ? document.body.innerText : "",
			links: Array.from(document.querySelectorAll("a")).slice(0, maxL).map((a) => ({
				text: (a.innerText || a.textContent || "").trim().slice(0, 200),
				href: a.href
			})),
			inputs: document.querySelectorAll("input, textarea, select").length
		};
	}, [maxText, maxLinks]);
	const compressed = compressText(data.text);
	return {
		url: page.url(),
		title: await page.title(),
		text: compressed.slice(0, maxText),
		truncated: compressed.length > maxText,
		links: data.links,
		inputs: data.inputs
	};
}
/**
* 解析点击/输入目标为 Locator:selector 直译;ref 走注册表——
* 先试快照时的 CSS 路径并校验 role/name 仍一致(防 ref 漂移误点),
* 不一致则降级 getByRole(role, {name}),均失败报「ref 已失效」。
*/
async function targetLocator(page, args) {
	if (args.ref !== void 0 && args.ref !== "") {
		const ref = String(args.ref);
		const entry = pageRef(page, ref);
		if (entry === void 0) throw new Error(`未知 ref: ${ref}(页面导航或重新快照后旧 ref 失效;请先 browser_snapshot { mode: "aria" })`);
		const byPath = page.locator(entry.selector).first();
		if (await byPath.count().catch(() => 0) > 0) {
			if (await byPath.evaluate((el, want) => {
				const tag = el.tagName.toLowerCase();
				const type = (el.getAttribute("type") ?? "").toLowerCase();
				const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
				const roleOk = want.role === "" || roleAttr === want.role || want.role === "link" && tag === "a" || want.role === "button" && (tag === "button" || tag === "summary" || tag === "input" && [
					"button",
					"submit",
					"reset",
					"image"
				].includes(type)) || ["textbox", "searchbox"].includes(want.role) && (tag === "textarea" || tag === "input" && ![
					"hidden",
					"checkbox",
					"radio"
				].includes(type)) || want.role === "combobox" && tag === "select" || want.role === "checkbox" && tag === "input" && type === "checkbox" || want.role === "radio" && tag === "input" && type === "radio";
				const aria = el.getAttribute("aria-label") ?? "";
				const ph = el.getAttribute("placeholder") ?? "";
				const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
				const nameOk = want.name === "" || aria.includes(want.name) || ph.includes(want.name) || text.includes(want.name);
				return roleOk && nameOk;
			}, {
				role: entry.role,
				name: entry.name
			}).catch(() => false)) return byPath;
		}
		const byRole = entry.name !== "" ? page.getByRole(entry.role, { name: entry.name }).first() : page.getByRole(entry.role).first();
		if (await byRole.count().catch(() => 0) > 0) return byRole;
		throw new Error(`ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`);
	}
	if (args.selector === void 0) throw new Error("需要 selector 或 ref 之一");
	return page.locator(String(args.selector)).first();
}
async function clickTool(config, args) {
	const page = await getPage(config);
	await (await targetLocator(page, args)).click({ timeout: args.timeoutMs ?? config.timeoutMs });
	await page.waitForLoadState("domcontentloaded").catch(() => {});
	return {
		clicked: String(args.ref ?? args.selector),
		...await pageIdentity(page)
	};
}
async function typeTool(config, args) {
	const page = await getPage(config);
	const target = await targetLocator(page, args);
	const text = String(args.text ?? "");
	if (args.clear === true) await target.fill(text, { timeout: args.timeoutMs ?? config.timeoutMs });
	else {
		await target.click({ timeout: args.timeoutMs ?? config.timeoutMs });
		await page.keyboard.type(text, { delay: args.delayMs ?? 0 });
	}
	if (args.submit === true) await page.keyboard.press("Enter");
	return {
		typed: true,
		selector: String(args.ref ?? args.selector),
		submit: args.submit === true,
		...await pageIdentity(page)
	};
}
async function pressTool(config, args) {
	const page = await getPage(config);
	const key = String(args.key);
	if (args.selector !== void 0 || args.ref !== void 0) await (await targetLocator(page, args)).press(key, { timeout: args.timeoutMs ?? config.timeoutMs });
	else await page.keyboard.press(key);
	return {
		pressed: key,
		...await pageIdentity(page)
	};
}
/** 组件库下拉框的可见选项选择器并集(antd / element-plus / 通用 ARIA listbox)。 */
const DROPDOWN_OPTION_SELECTOR = [
	".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
	".el-select-dropdown__item",
	"[role='listbox'] [role='option']"
].join(", ");
/**
* 下拉选择原语:原生 <select> 走 selectOption;组件库下拉(antd/element/listbox)
* 走「点击触发框 → 等待可见选项 → 按文本点击」。找不到选项时抛出错误并附当前可见
* 选项清单,agent 可直接据此修正,无需再手写 eval 探查。
*/
async function selectTool(config, args) {
	const page = await getPage(config);
	const target = await targetLocator(page, args);
	const label = String(args.ref ?? args.selector);
	const want = String(args.option ?? "");
	if (!want) throw new Error("select 需要 option(选项文本)");
	const exact = args.exact === true;
	const timeout = args.timeoutMs ?? config.timeoutMs;
	if (await target.evaluate((el) => el.tagName.toLowerCase()).catch(() => "") === "select") try {
		await target.selectOption({ label: want }, { timeout });
		return {
			selected: want,
			selector: label,
			...await pageIdentity(page)
		};
	} catch {
		const options = await target.locator("option").allTextContents();
		throw new Error(`原生下拉无选项 "${want}";可用选项: ${options.map((t) => t.trim()).join(" / ")}`);
	}
	await target.click({ timeout });
	const options = page.locator(DROPDOWN_OPTION_SELECTOR);
	await options.first().waitFor({
		state: "visible",
		timeout: Math.min(timeout, 5e3)
	}).catch(() => {});
	const texts = (await options.allTextContents()).map((t) => t.trim()).filter(Boolean);
	if (texts.length === 0) throw new Error(`点击 ${label} 后未出现下拉选项(非原生 select,也不是已知的组件库下拉)`);
	const index = texts.findIndex((t) => exact ? t === want : t.includes(want));
	if (index === -1) {
		await page.keyboard.press("Escape").catch(() => {});
		throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
	}
	await options.nth(index).click();
	return {
		selected: texts[index],
		selector: label,
		...await pageIdentity(page)
	};
}
async function evalTool(config, args) {
	const page = await getPage(config);
	const script = String(args.script ?? "");
	const wrapped = /[\n;]|^\s*return\b/.test(script) ? `(async () => {\n${script}\n})()` : `(${script})`;
	const raw = await page.evaluate(wrapped);
	let result;
	try {
		result = JSON.parse(JSON.stringify(raw ?? null));
	} catch {
		result = raw === void 0 ? null : String(raw);
	}
	return { result };
}
async function screenshotTool(config, args, exec) {
	const page = await getPage(config);
	const cwd = workspaceBaseDir(config, exec);
	if (typeof args.baseline === "string" && args.baseline !== "") {
		const baselineName = safeName(args.baseline);
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
			baseline: baselineName
		};
	}
	const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
	const dir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
	mkdirSync(dir, { recursive: true });
	const safeName$1 = String(args.name ?? `shot-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, "_");
	const fileName = safeName$1.endsWith(".png") ? safeName$1 : `${safeName$1}.png`;
	const filePath = join(dir, fileName);
	const buffer = await page.screenshot({ type: "png" });
	writeFileSync(filePath, buffer);
	noteScreenshotDir(dir);
	cleanupScreenshots(dir, {
		maxAgeDays: config.screenshotMaxAgeDays,
		maxCount: config.screenshotMaxCount
	});
	const viewport = page.viewportSize() ?? {
		width: 0,
		height: 0
	};
	return {
		path: filePath,
		bytes: buffer.length,
		width: viewport.width,
		height: viewport.height
	};
}
async function waitTool(config, args) {
	const page = await getPage(config);
	const ms = Math.max(0, Math.min(Number(args.ms ?? 1e3) || 0, 6e4));
	await page.waitForTimeout(ms);
	return {
		waitedMs: ms,
		...await pageIdentity(page)
	};
}
async function backTool(config) {
	const page = await getPage(config);
	await page.goBack().catch(() => {});
	return { ...await pageIdentity(page) };
}
async function reloadTool(config) {
	const page = await getPage(config);
	await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
	return { ...await pageIdentity(page) };
}
async function statusTool() {
	const page = activePage();
	const state = stateOf();
	const profiles = [];
	for (const [name, s] of profileStates) profiles.push({
		name,
		open: s.browser !== null || s.context !== null,
		tabs: s.pages.size,
		channel: s.channel ?? "",
		persistent: s.persistent
	});
	if (page === null) return {
		open: false,
		profile: currentProfile,
		channel: state.channel ?? "",
		tabs: 0,
		profiles
	};
	return {
		open: true,
		profile: currentProfile,
		channel: state.channel ?? "",
		tabs: state.pages.size,
		profiles,
		...await pageIdentity(page)
	};
}
async function tabsTool(config, args) {
	const action = args.action ?? "list";
	const state = stateOf();
	if (state.browser === null && state.context === null && action !== "list") await launchProfile(currentProfile, config);
	if (state.browser === null && state.context === null) return {
		action,
		tabs: [],
		activeId: -1
	};
	switch (action) {
		case "list": return {
			action,
			tabs: await tabList(),
			activeId: state.activeId ?? -1
		};
		case "new": {
			const page = await newPage(config);
			const id = state.counter++;
			state.pages.set(id, page);
			state.activeId = id;
			if (args.url) await page.goto(String(args.url), {
				waitUntil: args.waitUntil ?? "domcontentloaded",
				timeout: args.timeoutMs ?? config.timeoutMs
			});
			return {
				action,
				tab: {
					id,
					url: page.url(),
					title: await page.title()
				},
				tabs: await tabList(),
				activeId: state.activeId
			};
		}
		case "switch": {
			const id = resolveTabId(args);
			if (!state.pages.has(id)) throw new Error(`no tab with id ${id}`);
			state.activeId = id;
			return {
				action,
				activeId: state.activeId,
				tabs: await tabList()
			};
		}
		case "close": {
			const id = resolveTabId(args);
			const page = state.pages.get(id);
			if (page === void 0) throw new Error(`no tab with id ${id}`);
			await page.close().catch(() => {});
			state.pages.delete(id);
			if (state.activeId === id) {
				const next = state.pages.keys().next().value;
				state.activeId = next === void 0 ? null : next;
			}
			return {
				action,
				activeId: state.activeId ?? -1,
				tabs: await tabList()
			};
		}
		default: throw new Error(`unknown tabs action: ${action}`);
	}
}
function resolveTabId(args) {
	const state = stateOf();
	if (args.id !== void 0) return Number(args.id);
	if (args.index !== void 0) {
		const ids = [...state.pages.keys()];
		const idx = Number(args.index);
		if (idx < 0 || idx >= ids.length) throw new Error(`tab index ${idx} out of range`);
		return ids[idx];
	}
	if (state.activeId !== null) return state.activeId;
	throw new Error("no tab id/index given and no active tab");
}
async function downloadTool(config, args, exec) {
	let recentDownloads = downloadsOf(currentProfile);
	if (args.wait === true) {
		const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 1e4) || 1e4, 1e3), 6e4);
		const baseline = recentDownloads.length;
		const deadline = Date.now() + timeoutMs;
		while (recentDownloads.length <= baseline && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 300));
			recentDownloads = downloadsOf(currentProfile);
		}
		if (recentDownloads.length <= baseline) throw new Error(`等待下载超时(${timeoutMs}ms):未检测到新下载,请先在页面触发下载动作`);
	}
	if (recentDownloads.length === 0) throw new Error("no recent downloads. Trigger a download in the page first (e.g. browser_click on a download link).");
	const index = args.index !== void 0 ? Number(args.index) : recentDownloads.length - 1;
	const entry = recentDownloads[index];
	if (entry === void 0) throw new Error(`no download at index ${index}`);
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
		bytes: statSync(filePath).size
	};
}
async function uploadTool(config, args, exec) {
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
	await page.setInputFiles(String(args.selector), resolvedPath, { timeout: args.timeoutMs ?? config.timeoutMs });
	return {
		uploaded: filePath,
		bytes: stat.size,
		...await pageIdentity(page)
	};
}
async function cookiesTool(config, args) {
	const page = await getPage(config);
	const context = page.context();
	const action = args.action ?? "list";
	if (action === "list") return { cookies: (await context.cookies(args.url ?? page.url())).map((c) => ({
		name: c.name,
		value: args.showValues === true ? c.value : "(hidden — set showValues=true to reveal)",
		domain: c.domain,
		path: c.path,
		httpOnly: c.httpOnly,
		secure: c.secure,
		sameSite: c.sameSite,
		expires: c.expires
	})) };
	if (action === "set") {
		if (!args.name || args.value === void 0) throw new Error("set requires name and value");
		await context.addCookies([{
			name: String(args.name),
			value: String(args.value),
			url: args.url ?? page.url()
		}]);
		return {
			set: true,
			name: String(args.name),
			url: args.url ?? page.url()
		};
	}
	if (action === "clear") {
		await context.clearCookies();
		return { cleared: true };
	}
	throw new Error(`unknown cookies action: ${action}`);
}
async function formTool(config, args) {
	const page = await getPage(config);
	let fields = args.fields ?? [];
	if (!Array.isArray(fields) || fields.length === 0) {
		if (typeof args.from === "string" && savedForms.has(args.from)) fields = savedForms.get(args.from);
		else throw new Error("fields must be a non-empty array (or pass from=<saved form name>)");
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
		} else throw new Error("each field needs a selector or a label");
	}
	setLastFormFields(fields.map((f) => ({ ...f })));
	if (args.submit === true) await page.keyboard.press("Enter");
	return {
		filled,
		submit: args.submit === true,
		...await pageIdentity(page)
	};
}
async function formSaveTool(args) {
	let fields = args.fields;
	if (!Array.isArray(fields) || fields.length === 0) {
		if (lastFormFields.length === 0) throw new Error("no fields given and no previous browser_form to remember");
		fields = lastFormFields;
	}
	const name = String(args.name ?? "");
	if (!name) throw new Error("name is required");
	savedForms.set(name, fields.map((f) => ({ ...f })));
	return {
		saved: name,
		fields: fields.length
	};
}
async function formsTool(args) {
	const action = args.action ?? "list";
	if (action === "list") return { forms: [...savedForms.entries()].map(([name, fields]) => ({
		name,
		fields: fields.length,
		preview: fields.slice(0, 3).map((f) => f.selector ?? f.label ?? "?").join(", ")
	})) };
	if (action === "delete") {
		if (!args.name) throw new Error("name is required");
		return {
			deleted: savedForms.delete(String(args.name)),
			name: String(args.name)
		};
	}
	throw new Error(`unknown forms action: ${action}`);
}
async function profileTool(config, args) {
	const action = args.action ?? "list";
	const available = Object.keys(config.profiles ?? {});
	const describe = (name) => {
		const state = getProfileState(name);
		return {
			name,
			open: state.browser !== null || state.context !== null,
			tabs: state.pages.size,
			persistent: state.persistent,
			userDataDir: profileConfig(config, name).userDataDir ?? ""
		};
	};
	if (action === "list") return {
		current: currentProfile,
		profiles: available.map(describe)
	};
	if (action === "use") {
		const name = String(args.name ?? "");
		if (name !== "default" && !available.includes(name)) throw new Error(`unknown profile: ${name} (available: ${["default", ...available].join(", ")})`);
		setCurrentProfile(name);
		return {
			current: currentProfile,
			profiles: available.map(describe)
		};
	}
	throw new Error(`unknown profile action: ${action}`);
}
async function elementsTool(config, args) {
	const page = await getPage(config);
	const max = Math.min(Math.max(Number(args.max ?? 60) || 60, 1), 200);
	const data = await page.evaluate(([maxN, optionSelector]) => {
		/** 提取元素的关联 label:aria-label → label[for] → form-item 标签(antd/element)。 */
		function labelOf(el) {
			const aria = el.getAttribute("aria-label");
			if (aria) return aria.trim();
			if (el.id) {
				const text = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim();
				if (text) return text;
			}
			const antLabel = el.closest(".ant-form-item")?.querySelector(".ant-form-item-label")?.textContent?.trim();
			if (antLabel) return antLabel.replace(/[*：:]\s*$/, "");
			const elLabel = el.closest(".el-form-item")?.querySelector(".el-form-item__label")?.textContent?.trim();
			if (elLabel) return elLabel.replace(/[*：:]\s*$/, "");
			return "";
		}
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		const nodes = Array.from(document.querySelectorAll("input, textarea, select, button, a[href]"));
		for (const el of nodes) {
			if (out.length >= maxN) break;
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) continue;
			const info = {
				tag: el.tagName.toLowerCase(),
				type: el.type ?? "",
				name: el.name ?? "",
				id: el.id ?? "",
				label: labelOf(el),
				placeholder: el.placeholder ?? "",
				ariaLabel: el.getAttribute("aria-label") ?? "",
				text: (el.innerText || el.textContent || "").trim().slice(0, 80),
				href: el.href ?? "",
				selector: el.id !== "" ? `#${CSS.escape(el.id)}` : el.name !== "" ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : ""
			};
			const key = `${info.tag}|${info.name}|${info.id}|${info.placeholder}|${info.text}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(info);
		}
		return {
			elements: out,
			dropdownOptions: Array.from(document.querySelectorAll(optionSelector)).map((el) => (el.textContent ?? "").trim()).filter(Boolean).slice(0, 50)
		};
	}, [max, DROPDOWN_OPTION_SELECTOR]);
	return {
		count: data.elements.length,
		elements: data.elements,
		dropdownOptions: data.dropdownOptions
	};
}
async function closeTool() {
	await closeBrowser();
	return { closed: true };
}
/** 单次检查:返回 { ok, detail }。不抛错,失败时 detail 给出原因。 */
async function checkOnce(page, cond) {
	if (cond.ref !== void 0) {
		const state = String(cond.state ?? "visible");
		try {
			await (await targetLocator(page, { ref: cond.ref })).waitFor({
				state,
				timeout: 120
			});
			return { ok: true };
		} catch {
			return {
				ok: false,
				detail: `ref ${String(cond.ref)} 未达到 ${state}`
			};
		}
	}
	if (cond.selector !== void 0) {
		const locator = page.locator(String(cond.selector));
		const state = String(cond.state ?? "visible");
		try {
			await locator.waitFor({
				state,
				timeout: 120
			});
			return { ok: true };
		} catch {
			return {
				ok: false,
				detail: `元素 ${cond.selector} 未达到 ${state}`
			};
		}
	}
	if (cond.url !== void 0) {
		const url = page.url();
		try {
			return new RegExp(String(cond.url)).test(url) ? { ok: true } : {
				ok: false,
				detail: `URL 不匹配 ${cond.url}(当前 ${url})`
			};
		} catch {
			return {
				ok: false,
				detail: `非法正则: ${cond.url}`
			};
		}
	}
	if (cond.text !== void 0) {
		const needle = String(cond.text);
		try {
			return await page.evaluate((s) => (document.body ? document.body.innerText : "").includes(s), needle) ? { ok: true } : {
				ok: false,
				detail: `页面文本不含 "${needle}"`
			};
		} catch (e) {
			return {
				ok: false,
				detail: `文本检查失败: ${e instanceof Error ? e.message : String(e)}`
			};
		}
	}
	if (cond.count !== void 0 && typeof cond.count === "object") {
		const c = cond.count;
		try {
			const actual = await page.locator(String(c.selector)).count();
			const want = Number(c.value);
			const op = c.op ?? "eq";
			return (op === "eq" ? actual === want : op === "gt" ? actual > want : op === "gte" ? actual >= want : op === "lt" ? actual < want : op === "lte" ? actual <= want : false) ? { ok: true } : {
				ok: false,
				detail: `${c.selector} 数量 ${actual} 不满足 ${op} ${want}`
			};
		} catch (e) {
			return {
				ok: false,
				detail: `数量检查失败: ${e instanceof Error ? e.message : String(e)}`
			};
		}
	}
	if (cond.eval !== void 0) try {
		return await page.evaluate(String(cond.eval)) ? { ok: true } : {
			ok: false,
			detail: `eval 条件为假: ${cond.eval}`
		};
	} catch (e) {
		return {
			ok: false,
			detail: `eval 执行失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	throw new Error("条件无效: 需要 selector/url/text/count/eval 之一");
}
/** 轮询等待条件成立(intervalMs 步进),返回最后一次检查结果。 */
async function pollCondition(page, cond, timeoutMs, intervalMs = 500) {
	const deadline = Date.now() + timeoutMs;
	let last = {
		ok: false,
		detail: "超时"
	};
	while (Date.now() < deadline) {
		try {
			last = await checkOnce(page, cond);
			if (last.ok) return last;
		} catch (e) {
			last = {
				ok: false,
				detail: e instanceof Error ? e.message : String(e)
			};
		}
		await page.waitForTimeout(intervalMs);
	}
	return last;
}
/** 通用显式等待:等待条件成立,超时抛错。 */
async function waitForTool(config, args) {
	const page = await getPage(config);
	const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 1e4) || 1e4, 1e3), 12e4);
	const intervalMs = Math.max(Number(args.intervalMs ?? 500) || 500, 100);
	const result = await pollCondition(page, args.condition, timeoutMs, intervalMs);
	if (!result.ok) throw new Error(`等待条件超时(${timeoutMs}ms): ${result.detail ?? "条件未满足"}`);
	return {
		met: true,
		...await pageIdentity(page)
	};
}
/**
* 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
* 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
* successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
* 超时返回 loggedIn:false(不抛错)。
*/
async function waitForLoginTool(config, args) {
	const page = await getPage(config);
	const startUrl = page.url();
	let condition;
	if (args.successSelector) condition = {
		selector: String(args.successSelector),
		state: "visible"
	};
	else if (args.successUrl) condition = { url: String(args.successUrl) };
	else condition = { eval: `location.href !== ${JSON.stringify(startUrl)} && location.href !== "about:blank"` };
	const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 12e4) || 12e4, 5e3), 6e5);
	return {
		loggedIn: (await pollCondition(page, condition, timeoutMs, 2e3)).ok,
		...await pageIdentity(page)
	};
}
/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。visual 断言走像素比对。 */
async function assertTool(config, args, exec) {
	const page = await getPage(config);
	if (args.visual !== void 0 && typeof args.visual === "object") return visualAssert(config, args.visual, page, exec);
	const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 5e3) || 5e3, 100), 6e4);
	const intervalMs = Math.max(Number(args.intervalMs ?? 300) || 300, 50);
	const result = await pollCondition(page, args.condition, timeoutMs, intervalMs);
	if (result.ok) return {
		passed: true,
		...await pageIdentity(page)
	};
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
			maxCount: config.screenshotMaxCount
		});
	} catch {}
	throw new Error(`断言失败: ${result.detail ?? "条件未满足"}; 失败截图: ${filePath}`);
}
/**
* 页内像素比对(自包含函数,page.evaluate 序列化注入):
* 两张图按传入的 w/h 重绘,mask 区域填白后逐像素比较
* (加权亮度差 / 255 > threshold 计为差异像素),差异像素在 diff 图上标红。
* 注意:公式与测试里的 luminanceDelta 语义保持一致(0.2126/0.7152/0.0722)。
*/
async function compareImagesInPage(payload) {
	const load = (src) => new Promise((res, rej) => {
		const img = new Image();
		img.onload = () => res(img);
		img.onerror = () => rej(/* @__PURE__ */ new Error("image decode failed"));
		img.src = src;
	});
	const [a, b] = await Promise.all([load(payload.baseline), load(payload.current)]);
	const { width: w, height: h } = payload;
	const draw = (img) => {
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d");
		ctx.drawImage(img, 0, 0, w, h);
		return ctx;
	};
	const ctxA = draw(a);
	const ctxB = draw(b);
	for (const r of payload.maskRects) for (const ctx of [ctxA, ctxB]) {
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(r.x, r.y, r.width, r.height);
	}
	const da = ctxA.getImageData(0, 0, w, h).data;
	const db = ctxB.getImageData(0, 0, w, h).data;
	const diffCanvas = document.createElement("canvas");
	diffCanvas.width = w;
	diffCanvas.height = h;
	const dctx = diffCanvas.getContext("2d");
	dctx.drawImage(b, 0, 0, w, h);
	const dd = dctx.getImageData(0, 0, w, h);
	let diff = 0;
	for (let i = 0; i < da.length; i += 4) if ((.2126 * Math.abs(da[i] - db[i]) + .7152 * Math.abs(da[i + 1] - db[i + 1]) + .0722 * Math.abs(da[i + 2] - db[i + 2])) / 255 > payload.threshold) {
		diff++;
		dd.data[i] = 255;
		dd.data[i + 1] = 0;
		dd.data[i + 2] = 0;
		dd.data[i + 3] = 255;
	}
	const total = w * h;
	return {
		diffPixels: diff,
		totalPixels: total,
		diffRatio: total > 0 ? diff / total : 0,
		diffImage: diff > 0 ? diffCanvas.toDataURL("image/png") : null
	};
}
/**
* 视觉回归断言:与基线截图比对。基线缺失时报错提示先建基线;
* diffRatio 超过 maxDiffRatio 时落盘当前截图与 diff 图并抛错。
*/
async function visualAssert(config, visual, page, exec) {
	const baselineName = safeName(String(visual.baseline ?? ""));
	if (baselineName === "") throw new Error("visual 断言需要 baseline(基线名)");
	const cwd = workspaceBaseDir(config, exec);
	const baselineDir = config.baselineDir ?? ".dsh-browser/baselines";
	const dir = isAbsolute(baselineDir) ? baselineDir : resolve(cwd, baselineDir);
	const baselinePath = join(dir, `${baselineName}.png`);
	if (!existsSync(baselinePath)) throw new Error(`视觉基线不存在: ${baselinePath};先用 browser_screenshot { baseline: "${baselineName}" } 建立基线`);
	const baselineBuf = readFileSync(baselinePath);
	const currentBuf = await page.screenshot({ type: "png" });
	const baseSize = pngSize(baselineBuf);
	const curSize = pngSize(currentBuf);
	const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
	const shotDir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
	const saveEvidence = (suffix, data) => {
		mkdirSync(shotDir, { recursive: true });
		const p = join(shotDir, `visual-${safeName(baselineName)}-${suffix}-${Date.now()}.png`);
		writeFileSync(p, typeof data === "string" ? Buffer.from(data.split(",")[1] ?? "", "base64") : data);
		noteScreenshotDir(shotDir);
		return p;
	};
	if (baseSize.width !== curSize.width || baseSize.height !== curSize.height) {
		const currentPath = saveEvidence("current", currentBuf);
		throw new Error(`视觉回归失败: 尺寸不一致(基线 ${baseSize.width}x${baseSize.height},当前 ${curSize.width}x${curSize.height}); 当前截图: ${currentPath}`);
	}
	const maskSelectors = Array.isArray(visual.mask) ? visual.mask.map(String) : [];
	const rawRects = [];
	for (const sel of maskSelectors) {
		const rects = await page.locator(sel).evaluateAll((els) => els.map((el) => {
			const r = el.getBoundingClientRect();
			return {
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height
			};
		})).catch(() => []);
		rawRects.push(...rects);
	}
	const scale = Math.min(1, 1e3 / Math.max(curSize.width, curSize.height));
	const w = Math.max(1, Math.round(curSize.width * scale));
	const h = Math.max(1, Math.round(curSize.height * scale));
	const result = await page.evaluate(compareImagesInPage, {
		baseline: `data:image/png;base64,${baselineBuf.toString("base64")}`,
		current: `data:image/png;base64,${currentBuf.toString("base64")}`,
		threshold: Math.min(Math.max(Number(visual.threshold ?? .1) || .1, 0), 1),
		maskRects: scaleRects(rawRects, scale),
		width: w,
		height: h
	});
	const maxDiffRatio = Math.min(Math.max(Number(visual.maxDiffRatio ?? .005) || 0, 0), 1);
	if (result.diffRatio > maxDiffRatio) {
		const currentPath = saveEvidence("current", currentBuf);
		const diffPath = result.diffImage !== null ? saveEvidence("diff", result.diffImage) : "(无 diff 图)";
		throw new Error(`视觉回归失败: diffRatio ${(result.diffRatio * 100).toFixed(3)}%(${result.diffPixels}/${result.totalPixels} 像素)> 阈值 ${(maxDiffRatio * 100).toFixed(3)}%; 当前截图: ${currentPath}; diff 图: ${diffPath}`);
	}
	return {
		passed: true,
		visual: {
			baseline: baselineName,
			diffRatio: result.diffRatio,
			diffPixels: result.diffPixels
		},
		...await pageIdentity(page)
	};
}
function matchNetwork(entry, f) {
	if (f.urlSubstr && !entry.url.includes(String(f.urlSubstr))) return false;
	if (f.method && entry.method.toUpperCase() !== String(f.method).toUpperCase()) return false;
	if (f.status !== void 0 && Number(f.status) !== entry.status) return false;
	if (f.failedOnly === true && !entry.failed && (entry.status === void 0 || entry.status < 400)) return false;
	return true;
}
/** 网络记录查询:list / failed / wait / clear。 */
async function networkTool(args) {
	const action = args.action ?? "list";
	const entries = networkEntries(currentProfile);
	if (action === "clear") {
		clearNetwork(currentProfile);
		return {
			cleared: true,
			entries: []
		};
	}
	if (action === "wait") {
		if (!args.url) throw new Error("wait 需要 url(正则字符串)");
		const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 1e4) || 1e4, 1e3), 6e4);
		const startedAt = Date.now();
		const deadline = startedAt + timeoutMs;
		while (Date.now() < deadline) {
			const hit = [...entries].reverse().find((e) => {
				if (!new RegExp(String(args.url)).test(e.url)) return false;
				if (args.status !== void 0 && Number(args.status) !== e.status) return false;
				return true;
			});
			if (hit !== void 0) return {
				matched: hit,
				waitMs: Date.now() - startedAt
			};
			await new Promise((r) => setTimeout(r, 300));
		}
		const recent = entries.slice(-5).map((e) => `${e.method} ${e.url} → ${e.failed ? "FAILED" : e.status ?? "?"}`);
		throw new Error(`等待接口超时(${timeoutMs}ms): ${args.url}\n` + (recent.length > 0 ? `最近已见请求:\n  ${recent.join("\n  ")}` : "期间无任何接口请求记录"));
	}
	const filter = action === "failed" ? { failedOnly: true } : args;
	const list = [...entries].reverse().filter((e) => matchNetwork(e, filter)).slice(0, Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200));
	if (action === "stats") {
		const byHost = /* @__PURE__ */ new Map();
		for (const e of entries) {
			let host;
			try {
				host = new URL(e.url).host;
			} catch {
				host = "(invalid-url)";
			}
			let bucket = byHost.get(host);
			if (bucket === void 0) {
				bucket = {
					host,
					total: 0,
					failed: 0,
					totalMs: 0,
					withDuration: 0,
					byStatus: {}
				};
				byHost.set(host, bucket);
			}
			bucket.total++;
			if (e.failed === true || e.status !== void 0 && e.status >= 400) bucket.failed++;
			if (e.durationMs !== void 0) {
				bucket.totalMs += e.durationMs;
				bucket.withDuration++;
			}
			if (e.status !== void 0) {
				const key = String(e.status);
				bucket.byStatus[key] = (bucket.byStatus[key] ?? 0) + 1;
			}
		}
		return { stats: [...byHost.values()].map((b) => ({
			host: b.host,
			total: b.total,
			failed: b.failed,
			avgMs: b.withDuration > 0 ? Math.round(b.totalMs / b.withDuration) : null,
			byStatus: b.byStatus
		})).sort((a, b) => b.total - a.total) };
	}
	if (action === "failed") return { failed: list };
	if (action === "list") return { entries: list };
	throw new Error(`unknown network action: ${action}`);
}
/** 只读工具集合:stripReads 保存时剔除(browser_cookies 仅 list 动作算只读)。 */
const READONLY_TOOLS = /* @__PURE__ */ new Set([
	"browser_snapshot",
	"browser_elements",
	"browser_eval",
	"browser_network",
	"browser_status"
]);
function isReadonlyStep(step) {
	if (READONLY_TOOLS.has(step.tool)) return true;
	if (step.tool === "browser_cookies") return (step.args?.action ?? "list") === "list";
	return false;
}
/** 使用 args.selector 定位的工具集合(自愈与录制指纹的作用范围)。 */
const SELECTOR_STEP_TOOLS = /* @__PURE__ */ new Set([
	"browser_click",
	"browser_type",
	"browser_press",
	"browser_select",
	"browser_upload"
]);
/**
* 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
* 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
*/
async function captureSelectorHint(page, selector) {
	return page.locator(selector).first().evaluate((el) => {
		const tag = el.tagName.toLowerCase();
		const type = (el.getAttribute("type") ?? "").toLowerCase();
		const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
		const implicit = tag === "a" && el.hasAttribute("href") ? "link" : tag === "button" || tag === "summary" || tag === "input" && [
			"button",
			"submit",
			"reset",
			"image"
		].includes(type) ? "button" : tag === "textarea" || tag === "input" && ![
			"hidden",
			"checkbox",
			"radio",
			"file"
		].includes(type) ? "textbox" : tag === "select" ? "combobox" : tag === "input" && type === "checkbox" ? "checkbox" : tag === "input" && type === "radio" ? "radio" : "";
		const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
		const name = (el.getAttribute("aria-label") ?? "").trim() || (el.getAttribute("placeholder") ?? "").trim() || text;
		return {
			testid: el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? void 0,
			id: el.id !== "" ? el.id : void 0,
			tag,
			role: (roleAttr || implicit) !== "" ? roleAttr || implicit : void 0,
			name: name !== "" ? name : void 0,
			text: text !== "" ? text : void 0
		};
	}).catch(() => null);
}
/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
function healCandidates(hint) {
	const out = [];
	const q = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
	if (hint.testid !== void 0 && hint.testid !== "") out.push({
		via: "testid",
		selector: `css=[data-testid="${q(hint.testid)}"]`
	});
	if (hint.role !== void 0 && hint.role !== "" && hint.name !== void 0 && hint.name !== "") out.push({
		via: "role+name",
		selector: `role=${hint.role}[name="${q(hint.name)}"]`
	});
	if (hint.text !== void 0 && hint.text !== "") out.push({
		via: "text",
		selector: `text="${q(hint.text)}"`
	});
	if (hint.id !== void 0 && hint.id !== "") out.push({
		via: "id",
		selector: `css=[id="${q(hint.id)}"]`
	});
	if (hint.tag !== void 0 && hint.tag !== "" && hint.text !== void 0 && hint.text !== "") out.push({
		via: "tag+text",
		selector: `css=${hint.tag}:has-text("${q(hint.text)}")`
	});
	return out;
}
/** 录制管理:start / stop / save / list / delete。 */
async function recordTool(args) {
	const action = args.action ?? "start";
	if (action === "start") {
		startRecording();
		return {
			recording: true,
			hint: "后续浏览器工具调用将记录;用 browser_record stop 结束,再 save <name> 保存"
		};
	}
	if (action === "stop") {
		if (!isRecording()) throw new Error("当前没有录制");
		return {
			recording: false,
			steps: stopRecording().length
		};
	}
	if (action === "save") {
		if (isRecording()) throw new Error("录制未结束:先 browser_record stop");
		const name = String(args.name ?? "");
		if (!name) throw new Error("save 需要 name");
		const recorded = lastRecordingOf();
		const source = recorded !== null ? "recording" : "recent-log";
		const rawSteps = recorded !== null ? recorded.map((c) => ({
			tool: c.tool,
			args: c.args ?? {},
			...c.meta !== void 0 ? { meta: c.meta } : {}
		})) : testLogOf().reverse().slice(-100).map((c) => ({
			tool: c.tool,
			args: c.args ?? {},
			...c.meta !== void 0 ? { meta: c.meta } : {}
		}));
		const steps = args.stripReads === true ? rawSteps.filter((s) => !isReadonlyStep(s)) : rawSteps;
		const stripped = rawSteps.length - steps.length;
		let varsApplied = 0;
		if (args.vars !== void 0 && typeof args.vars === "object" && args.vars !== null) for (const [varName, path] of Object.entries(args.vars)) {
			const m = /^#(\d+)\.args\.([\w.]+)$/.exec(String(path));
			if (m === null) throw new Error(`vars.${varName}: 路径格式应为 "#步骤号.args.字段"(如 "#3.args.text"),实际: ${String(path)}`);
			const step = steps[Number(m[1]) - 1];
			if (step === void 0) throw new Error(`vars.${varName}: 步骤 #${m[1]} 不存在(共 ${steps.length} 步)`);
			setPath(step.args, m[2], `{{${varName}}}`);
			varsApplied++;
		}
		savedRecordings.set(name, {
			steps,
			savedAt: Date.now()
		});
		const file = saveRecordingFile(name, steps);
		const warnings = [];
		steps.forEach((s, i) => {
			if (s.tool !== "browser_upload") return;
			const p = s.args?.path;
			if (typeof p === "string" && p.length > 0 && !existsSync(p)) warnings.push(`#${i + 1} browser_upload: 文件不存在 ${p},回放此步骤将失败`);
		});
		return {
			saved: name,
			steps: steps.length,
			source,
			file,
			...stripped > 0 ? { stripped } : {},
			...varsApplied > 0 ? { varsApplied } : {},
			...warnings.length > 0 ? { warnings } : {},
			hint: "已持久化到磁盘,重启 DSH 后仍可回放"
		};
	}
	if (action === "list") return { recordings: listRecordings() };
	if (action === "delete") {
		if (!args.name) throw new Error("delete 需要 name");
		const name = String(args.name);
		return {
			deleted: deleteRecording(name),
			name
		};
	}
	throw new Error(`unknown record action: ${action}`);
}
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
async function runReplay(steps, impls, failFast, opts = {}) {
	const results = [];
	let stoppedAt = null;
	let passed = 0;
	let healedCount = 0;
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		const impl = impls[step.tool];
		if (impl === void 0) {
			results.push({
				index: i,
				tool: step.tool,
				ok: false,
				error: `未知步骤工具: ${step.tool}`
			});
			if (failFast) {
				stoppedAt = i;
				break;
			}
			continue;
		}
		const hint = step.meta?.hint;
		if (!(opts.healing === true && hint !== void 0 && SELECTOR_STEP_TOOLS.has(step.tool) && typeof step.args?.selector === "string")) {
			try {
				await impl(step.args ?? {});
				passed++;
				results.push({
					index: i,
					tool: step.tool,
					ok: true
				});
			} catch (e) {
				results.push({
					index: i,
					tool: step.tool,
					ok: false,
					error: e instanceof Error ? e.message : String(e)
				});
				if (failFast) {
					stoppedAt = i;
					break;
				}
			}
			continue;
		}
		const healTimeout = opts.healTimeoutMs ?? 3e3;
		const quickArgs = {
			...step.args,
			timeoutMs: Math.min(Number(step.args.timeoutMs ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY, healTimeout)
		};
		try {
			await impl(quickArgs);
			passed++;
			results.push({
				index: i,
				tool: step.tool,
				ok: true
			});
			continue;
		} catch (e0) {
			const tried = [];
			let healed = null;
			for (const candidate of healCandidates(hint)) {
				tried.push(`${candidate.via}: ${candidate.selector}`);
				try {
					await impl({
						...step.args,
						selector: candidate.selector,
						timeoutMs: healTimeout
					});
					healed = candidate;
					break;
				} catch {}
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
					resolved: healed.selector
				});
			} else {
				const base = e0 instanceof Error ? e0.message : String(e0);
				results.push({
					index: i,
					tool: step.tool,
					ok: false,
					error: `${base}${tried.length > 0 ? `; 自愈已尝试: ${tried.join(" | ")}` : ""}`
				});
				if (failFast) {
					stoppedAt = i;
					break;
				}
			}
		}
	}
	return {
		total: steps.length,
		passed,
		failed: results.length - passed,
		healedCount,
		...stoppedAt !== null ? { stoppedAt } : {},
		results
	};
}
/**
* 页内抽取(自包含函数,page.evaluate 序列化注入):
* attr 缺省取可见文本(innerText/textContent),否则 getAttribute(attr);
* multiple 收集所有命中;fields 嵌套时在每个命中元素内递归抽取。
*/
function extractFieldsInPage(fields) {
	const val = (el, attr) => {
		if (el === null) return null;
		if (attr !== void 0 && attr !== "" && attr !== "text" && attr !== "textContent") return el.getAttribute(attr);
		return (el.innerText || el.textContent || "").trim();
	};
	const run = (scope, spec) => {
		const out = {};
		for (const f of spec) {
			const els = Array.from(scope.querySelectorAll(f.selector));
			if (f.multiple === true) {
				if (Array.isArray(f.fields) && f.fields.length > 0) out[f.name] = els.map((el) => run(el, f.fields));
				else out[f.name] = els.map((el) => val(el, f.attr));
			} else {
				const el = els[0] ?? null;
				if (el !== null && Array.isArray(f.fields) && f.fields.length > 0) out[f.name] = run(el, f.fields);
				else out[f.name] = val(el, f.attr);
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
function rowsOfExtract(result, fields) {
	const multi = fields.filter((f) => f.multiple === true);
	if (multi.length === 1) {
		const name = multi[0].name;
		return (Array.isArray(result[name]) ? result[name] : []).map((item) => item !== null && typeof item === "object" ? item : { [name]: item });
	}
	return [result];
}
/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
function workspaceFilePath(cwd, file) {
	const p = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
	const root = resolve(cwd);
	if (p !== root && !p.startsWith(root + "/") && !p.startsWith(root + "\\")) throw new Error(`文件路径越出工作区: ${file}`);
	return p;
}
/**
* 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
* 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
*/
async function extractTool(config, args, exec) {
	const page = await getPage(config);
	const fields = args.fields;
	if (!Array.isArray(fields) || fields.length === 0) throw new Error("extract 需要 fields:[{ name, selector, attr?, multiple?, fields? }]");
	for (const f of fields) if (typeof f?.name !== "string" || f.name === "" || typeof f?.selector !== "string" || f.selector === "") throw new Error("fields 每项需要非空 name 与 selector");
	const maxPages = Math.min(Math.max(Number(args.maxPages ?? 1) || 1, 1), 100);
	const maxRows = Math.min(Math.max(Number(args.maxRows ?? config.maxRows ?? 1e3) || 1e3, 1), 1e5);
	const waitAfterMs = Math.min(Math.max(Number(args.waitAfterMs ?? 800) || 0, 0), 1e4);
	const rows = [];
	let pages = 0;
	for (;;) {
		const result = await page.evaluate(extractFieldsInPage, fields);
		rows.push(...rowsOfExtract(result, fields));
		pages++;
		if (rows.length >= maxRows) break;
		const nextSel = typeof args.next === "string" && args.next !== "" ? args.next : null;
		if (nextSel === null || pages >= maxPages) break;
		const next = page.locator(nextSel).first();
		if (await next.count().catch(() => 0) === 0) break;
		if (!await next.evaluate((el) => {
			const style = getComputedStyle(el);
			const rect = el.getBoundingClientRect();
			const visible = style.visibility !== "hidden" && style.display !== "none" && (rect.width > 0 || rect.height > 0);
			const disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true" || el.classList.contains("disabled") || el.classList.contains("ant-pagination-disabled");
			return visible && !disabled;
		}).catch(() => false)) break;
		await next.click();
		await page.waitForLoadState("domcontentloaded").catch(() => {});
		if (waitAfterMs > 0) await page.waitForTimeout(waitAfterMs);
	}
	const truncated = rows.length > maxRows;
	const finalRows = truncated ? rows.slice(0, maxRows) : rows;
	const format = typeof args.format === "string" && args.format !== "" ? args.format : (typeof args.file === "string" ? formatFromFile(args.file) : null) ?? "json";
	if (![
		"json",
		"csv",
		"jsonl",
		"markdown"
	].includes(format)) throw new Error(`未知 format: ${format}(支持 json / csv / jsonl / markdown)`);
	let file;
	let bytes;
	if (typeof args.file === "string" && args.file !== "") {
		file = workspaceFilePath(workspaceBaseDir(config, exec), args.file);
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
		...truncated ? { truncated: true } : { truncated: false },
		...file !== void 0 ? {
			file,
			bytes
		} : {},
		...await pageIdentity(page)
	};
}
/** 批处理内禁止嵌套的工具(防 batch→replay→batch 递归与录制自引用)。 */
const BATCH_FORBIDDEN = /* @__PURE__ */ new Set([
	"browser_batch",
	"browser_replay",
	"browser_record"
]);
/**
* 回归报告:list 列出最近运行,show 看单条详情,
* export 聚合生成 Markdown/HTML 报告落盘工作区。
*/
async function reportTool(config, args, exec) {
	const action = args.action ?? "list";
	if (action === "list") return { runs: listRuns(Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 200)).map((r) => ({
		runId: r.runId,
		ts: r.ts,
		kind: r.kind,
		source: r.source,
		total: r.total,
		passed: r.passed,
		failed: r.failed,
		healedCount: r.healedCount,
		durationMs: r.durationMs,
		...r.row !== void 0 ? { row: r.row } : {}
	})) };
	if (action === "show") {
		const run = typeof args.runId === "string" && args.runId !== "" ? getRun(args.runId) : latestRun();
		if (run === null) throw new Error(typeof args.runId === "string" ? `无此运行记录: ${args.runId}` : "暂无运行记录(先跑一次 browser_replay)");
		return { run };
	}
	if (action === "export") {
		const format = args.format === "html" ? "html" : "markdown";
		const source = typeof args.source === "string" && args.source !== "" ? args.source : void 0;
		const runs = listRuns(Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 1e3)).filter((r) => source === void 0 || r.source === source);
		if (runs.length === 0) throw new Error(source !== void 0 ? `来源 "${source}" 暂无运行记录` : "暂无运行记录(先跑一次 browser_replay)");
		const content = format === "html" ? renderHtmlReport(runs, source) : renderMarkdownReport(runs, source);
		const file = workspaceFilePath(workspaceBaseDir(config, exec), typeof args.file === "string" && args.file !== "" ? args.file : `reports/regression-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.${format === "html" ? "html" : "md"}`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content, "utf8");
		return {
			file,
			bytes: Buffer.byteLength(content, "utf8"),
			runs: runs.length,
			format
		};
	}
	throw new Error(`unknown report action: ${action}`);
}
/**
* 动作批处理:一次调用顺序执行多个浏览器步骤(内核复用 runReplay),
* 减少「点击→等待→输入」类固定小序列的工具往返。步骤内禁止嵌套
* batch/replay/record;批整体在操作轨迹里记为一条 browser_batch。
*/
async function batchTool(args, impls, config) {
	const steps = args.steps;
	if (!Array.isArray(steps) || steps.length === 0) throw new Error("batch 需要非空 steps 数组:[{ tool, args }]");
	const guarded = { ...impls };
	for (const name of BATCH_FORBIDDEN) guarded[name] = async () => {
		throw new Error(`不允许嵌套: batch 步骤不能调用 ${name}`);
	};
	const failFast = args.failFast !== false;
	const opts = {
		healing: config?.selectorHealing !== false,
		healTimeoutMs: config?.healTimeoutMs ?? 3e3
	};
	const t0 = Date.now();
	const result = await runReplay(steps, guarded, failFast, opts);
	noteRun({
		kind: "batch",
		source: "batch",
		total: result.total,
		passed: result.passed,
		failed: result.failed,
		healedCount: result.healedCount,
		durationMs: Date.now() - t0,
		results: result.results
	});
	const stoppedAt = result.stoppedAt;
	return {
		...result,
		summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== void 0 ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈` : ""}`
	};
}
/** 设置嵌套路径的值(路径段按 . 拆分,供 record save 的 vars 占位替换)。 */
function setPath(obj, path, value) {
	const segs = path.split(".");
	let cur = obj;
	for (let i = 0; i < segs.length - 1; i++) {
		const next = cur[segs[i]];
		if (next === null || typeof next !== "object") throw new Error(`路径不存在: ${path}`);
		cur = next;
	}
	cur[segs[segs.length - 1]] = value;
}
/** 收集步骤中所有 {{var}} 占位符名(导出供测试)。 */
function findPlaceholders(steps) {
	const found = /* @__PURE__ */ new Set();
	const walk = (v) => {
		if (typeof v === "string") for (const m of v.matchAll(/\{\{([\w-]+)\}\}/g)) found.add(m[1]);
		else if (Array.isArray(v)) v.forEach(walk);
		else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
	};
	steps.forEach((s) => walk(s.args));
	return [...found];
}
/**
* 深拷贝步骤并替换字符串叶子里的 {{var}} 占位符(导出供测试)。
* vars 缺失的占位符保留原样(由调用方先 findPlaceholders 校验)。
*/
function substituteVars(steps, vars) {
	const walk = (v) => {
		if (typeof v === "string") return v.replace(/\{\{([\w-]+)\}\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
		if (Array.isArray(v)) return v.map(walk);
		if (v !== null && typeof v === "object") {
			const out = {};
			for (const [k, val] of Object.entries(v)) out[k] = walk(val);
			return out;
		}
		return v;
	};
	return steps.map((s) => ({
		...s,
		args: walk(s.args)
	}));
}
/** 运行结果落一条运行记录(runs.jsonl);失败静默,不阻断主流程。 */
function noteRun(record) {
	try {
		const ts = Date.now();
		appendRun({
			runId: makeRunId(ts),
			ts,
			...record
		});
	} catch {}
}
/**
* 回放入口:name(已保存录制)或 steps(数组)二选一。
* vars 注入 {{占位符}};data/dataFile 数据集模式逐行运行并聚合。
*/
async function replayTool(args, impls, config, exec) {
	let steps = [];
	let source = "steps";
	if (typeof args.name === "string" && args.name) {
		const saved = savedRecordings.get(args.name);
		if (saved === void 0) throw new Error(`未找到录制: ${args.name}`);
		steps = saved.steps;
		source = args.name;
	} else if (Array.isArray(args.steps)) steps = args.steps;
	else throw new Error("replay 需要 name(已保存录制)或 steps(步骤数组)");
	if (steps.length === 0) throw new Error("步骤为空");
	const failFast = args.failFast !== false;
	const opts = {
		healing: config?.selectorHealing !== false,
		healTimeoutMs: config?.healTimeoutMs ?? 3e3
	};
	let rows = null;
	if (Array.isArray(args.data)) rows = args.data;
	else if (typeof args.dataFile === "string" && args.dataFile !== "") {
		const file = workspaceFilePath(workspaceBaseDir(config ?? {}, exec), args.dataFile);
		if (!existsSync(file)) throw new Error(`dataFile 不存在: ${file}`);
		rows = parseCsv(readFileSync(file, "utf8"));
	}
	if (rows !== null) {
		if (rows.length === 0) throw new Error("数据集为空(0 行)");
		const placeholders = findPlaceholders(steps);
		const runs = [];
		let okRows = 0;
		for (let i = 0; i < rows.length; i++) {
			const rowVars = {
				...args.vars,
				...rows[i]
			};
			const missing = placeholders.filter((p) => !(p in rowVars));
			const t0 = Date.now();
			if (missing.length > 0) {
				runs.push({
					row: i,
					total: steps.length,
					passed: 0,
					failed: steps.length,
					healedCount: 0,
					results: [],
					error: `缺少变量: ${missing.join(", ")}`
				});
				noteRun({
					kind: "replay",
					source,
					total: steps.length,
					passed: 0,
					failed: steps.length,
					healedCount: 0,
					durationMs: Date.now() - t0,
					row: i,
					results: []
				});
				continue;
			}
			const result = await runReplay(substituteVars(steps, rowVars), impls, failFast, opts);
			result.stoppedAt;
			runs.push({
				row: i,
				...result
			});
			if (result.failed === 0) okRows++;
			noteRun({
				kind: "replay",
				source,
				total: result.total,
				passed: result.passed,
				failed: result.failed,
				healedCount: result.healedCount,
				durationMs: Date.now() - t0,
				row: i,
				results: result.results
			});
		}
		return {
			source,
			rows: rows.length,
			passedRows: okRows,
			failedRows: rows.length - okRows,
			runs,
			summary: `数据集 ${okRows}/${rows.length} 行通过${okRows < rows.length ? `,${rows.length - okRows} 行失败` : ""}`
		};
	}
	const vars = args.vars ?? {};
	const missing = findPlaceholders(steps).filter((p) => !(p in vars));
	if (missing.length > 0) throw new Error(`缺少变量: ${missing.join(", ")}(录制含 {{占位符}},请用 vars 提供)`);
	const t0 = Date.now();
	const result = await runReplay(substituteVars(steps, vars), impls, failFast, opts);
	const stoppedAt = result.stoppedAt;
	noteRun({
		kind: "replay",
		source,
		total: result.total,
		passed: result.passed,
		failed: result.failed,
		healedCount: result.healedCount,
		durationMs: Date.now() - t0,
		results: result.results
	});
	return {
		source,
		...result,
		summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== void 0 ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈(建议修复录制选择器)` : ""}`
	};
}
//#endregion
//#region lib/types/browser/register.js
function registerTools(ctx, config) {
	const tools = ctx.get("tools");
	if (tools === void 0) return;
	setToolsLogger((m) => ctx.logger?.info?.(m));
	const timeout = (ms) => ms ?? config.timeoutMs;
	/** 参数净化:大字段(script/fields 等)截断,避免操作日志膨胀。 */
	function sanitizeArgs(args) {
		if (typeof args !== "object" || args === null) return args;
		const out = {};
		for (const [k, v] of Object.entries(args)) {
			const s = JSON.stringify(v);
			out[k] = s && s.length > 300 ? `${s.slice(0, 300)}…(截断)` : v;
		}
		return out;
	}
	/** 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。 */
	function register(def) {
		const original = def.execute;
		def.execute = async (args, exec) => {
			const t0 = Date.now();
			const sanitized = sanitizeArgs(args);
			try {
				const value = await original(args, exec);
				const call = recordCall({
					tool: def.name,
					args: sanitized,
					ok: true,
					ms: Date.now() - t0,
					ts: Date.now()
				});
				if (isRecording() && SELECTOR_STEP_TOOLS.has(def.name) && typeof args?.selector === "string") {
					const page = activePage();
					if (page !== null) {
						const hintResult = await captureSelectorHint(page, String(args.selector));
						if (hintResult !== null) call.meta = { hint: hintResult };
					}
				}
				return value;
			} catch (error) {
				recordCall({
					tool: def.name,
					args: sanitized,
					ok: false,
					ms: Date.now() - t0,
					ts: Date.now(),
					error: error instanceof Error ? error.message : String(error)
				});
				throw error;
			}
		};
		tools.register(def);
	}
	/** 回放步骤 → 工具实现映射(config 闭包)。 */
	const stepImpls = {
		browser_open: (a) => openTool(config, a),
		browser_snapshot: (a) => snapshotTool(config, a),
		browser_click: (a) => clickTool(config, a),
		browser_type: (a) => typeTool(config, a),
		browser_press: (a) => pressTool(config, a),
		browser_select: (a) => selectTool(config, a),
		browser_eval: (a) => evalTool(config, a),
		browser_screenshot: (a) => screenshotTool(config, a),
		browser_wait: (a) => waitTool(config, a),
		browser_back: () => backTool(config),
		browser_reload: () => reloadTool(config),
		browser_status: () => statusTool(),
		browser_close: () => closeTool(),
		browser_tabs: (a) => tabsTool(config, a),
		browser_download: (a) => downloadTool(config, a),
		browser_upload: (a) => uploadTool(config, a),
		browser_cookies: (a) => cookiesTool(config, a),
		browser_form: (a) => formTool(config, a),
		browser_form_save: (a) => formSaveTool(a),
		browser_forms: (a) => formsTool(a),
		browser_profile: (a) => profileTool(config, a),
		browser_elements: (a) => elementsTool(config, a),
		browser_wait_for_login: (a) => waitForLoginTool(config, a),
		browser_wait_for: (a) => waitForTool(config, a),
		browser_assert: (a) => assertTool(config, a, void 0),
		browser_network: (a) => networkTool(a),
		browser_record: (a) => recordTool(a),
		browser_replay: (a) => replayTool(a, stepImpls, config),
		browser_batch: (a) => batchTool(a, stepImpls, config),
		browser_extract: (a) => extractTool(config, a)
	};
	register(definePlainTool({
		name: "browser_open",
		description: "在共享浏览器中打开一个 URL。之后可用 browser_snapshot 读取页面内容,用 browser_click / browser_type / browser_eval 操作页面,用 browser_screenshot 截图。",
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "要打开的完整 URL(含协议)。"
				},
				waitUntil: {
					type: "string",
					enum: [
						"load",
						"domcontentloaded",
						"commit"
					],
					description: "等待策略,默认 domcontentloaded。"
				},
				timeoutMs: {
					type: "integer",
					description: "等待超时(毫秒)。"
				}
			},
			required: ["url"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				url: { type: "string" },
				title: { type: "string" },
				status: { type: "string" }
			},
			required: [
				"url",
				"title",
				"status"
			]
		},
		render: (_args, value) => `Opened ${value.url}\nTitle: ${value.title}`,
		presentCall: (args) => genericCard("browser", String(args.url), String(args.url)),
		timeoutMs: timeout(),
		execute: (args) => openTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_snapshot",
		description: "读取当前页面快照(不截图)。mode:'text'(默认)返回压缩后的可见文本+链接清单,适合读内容;'aria' 返回可访问性树,可交互元素带 [ref=eN] 短引用,后续 browser_click/browser_type/browser_select/browser_press 可直接传 ref 代替 CSS 选择器(导航或重新快照后旧 ref 失效)。maxTextChars 默认 20000。",
		parameters: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["text", "aria"],
					description: "快照模式,默认 text。"
				},
				maxTextChars: {
					type: "integer",
					description: "文本截断上限。"
				},
				maxLinks: {
					type: "integer",
					description: "链接数量上限(text 模式)。"
				},
				maxRefs: {
					type: "integer",
					description: "ref 分配上限(aria 模式,默认 200)。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				url: { type: "string" },
				title: { type: "string" },
				text: { type: "string" },
				truncated: { type: "boolean" },
				links: {
					type: "array",
					items: { type: "object" }
				},
				inputs: { type: "integer" },
				tree: { type: "string" },
				refs: { type: "integer" }
			},
			required: [
				"url",
				"title",
				"truncated"
			]
		},
		render: (_args, value) => {
			if (value.tree !== void 0) return `URL: ${value.url}\nTitle: ${value.title}\nRefs: ${value.refs}\n--- aria tree ---\n${value.tree}`;
			return `URL: ${value.url}\nTitle: ${value.title}\nInputs: ${value.inputs}\n--- text ---\n${value.text}`;
		},
		timeoutMs: timeout(),
		execute: (args) => snapshotTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_click",
		description: "点击页面元素:selector(CSS)或 ref(来自 browser_snapshot mode:'aria')二选一。",
		parameters: {
			type: "object",
			properties: {
				selector: {
					type: "string",
					description: "CSS 选择器。"
				},
				ref: {
					type: "string",
					description: "aria 快照的 ref(如 'e3');导航后失效。"
				},
				timeoutMs: { type: "integer" }
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				clicked: { type: "string" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"clicked",
				"url",
				"title"
			]
		},
		render: (_args, value) => `Clicked ${value.clicked}\nNow at: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args) => clickTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_type",
		description: "向输入框输入文本:selector(CSS)或 ref 二选一。clear=true 时先清空再输入(推荐用于表单);submit=true 时输入后按回车。",
		parameters: {
			type: "object",
			properties: {
				selector: { type: "string" },
				ref: {
					type: "string",
					description: "aria 快照的 ref(如 'e2')。"
				},
				text: { type: "string" },
				clear: { type: "boolean" },
				submit: { type: "boolean" },
				delayMs: { type: "integer" },
				timeoutMs: { type: "integer" }
			},
			required: ["text"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				typed: { type: "boolean" },
				selector: { type: "string" },
				submit: { type: "boolean" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"typed",
				"selector",
				"submit",
				"url",
				"title"
			]
		},
		render: (_args, value) => `Typed into ${value.selector}${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args) => typeTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_press",
		description: "按键:有 selector 或 ref 时先聚焦该元素再按键(如 'Enter'、'Tab'、'Escape'、'Control+a'),否则在页面级按键。",
		parameters: {
			type: "object",
			properties: {
				key: {
					type: "string",
					description: "按键名(Playwright 键盘键名)。"
				},
				selector: { type: "string" },
				ref: {
					type: "string",
					description: "aria 快照的 ref。"
				},
				timeoutMs: { type: "integer" }
			},
			required: ["key"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				pressed: { type: "string" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"pressed",
				"url",
				"title"
			]
		},
		render: (_args, value) => `Pressed ${value.pressed}`,
		timeoutMs: timeout(),
		execute: (args) => pressTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_select",
		description: "下拉选择原语:原生 <select> 与组件库下拉(antd / element-plus / ARIA listbox)通用。selector 或 ref 指向下拉触发框,option 为选项文本(默认包含匹配,exact=true 精确)。找不到选项时报错并列出可见选项,无需再 browser_eval 探查。",
		parameters: {
			type: "object",
			properties: {
				selector: {
					type: "string",
					description: "下拉触发框的 CSS 选择器(如 #rc_select_1)。"
				},
				ref: {
					type: "string",
					description: "aria 快照的 ref。"
				},
				option: {
					type: "string",
					description: "要选择的选项文本。"
				},
				exact: {
					type: "boolean",
					description: "精确匹配,默认 false(包含匹配)。"
				},
				timeoutMs: { type: "integer" }
			},
			required: ["option"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				selected: { type: "string" },
				selector: { type: "string" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"selected",
				"selector",
				"url",
				"title"
			]
		},
		render: (_args, value) => `Selected "${value.selected}" in ${value.selector}`,
		timeoutMs: timeout(),
		execute: (args) => selectTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_eval",
		description: "在页面上下文执行一段 JavaScript。表达式直接求值(如 'document.title');含换行/分号的语句会被包进 async IIFE,可用 return 返回。结果必须是可 JSON 序列化的值。",
		parameters: {
			type: "object",
			properties: { script: {
				type: "string",
				description: "要执行的 JavaScript。"
			} },
			required: ["script"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: { result: {} },
			required: ["result"]
		},
		render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
		timeoutMs: timeout(),
		execute: (args) => evalTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_screenshot",
		description: "把当前页面截图保存为 PNG 文件(默认存到工作区 .dsh-browser/screenshots/),返回文件路径。传 baseline=<名字> 时存为视觉回归基线(.dsh-browser/baselines/,不受清理策略约束),供 browser_assert 的 visual 断言比对。纯文本模型看不到图,但用户可以在实时画面面板查看。",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "文件名(不含扩展名也会自动补 .png)。"
				},
				baseline: {
					type: "string",
					description: "存为视觉回归基线(基线名)。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				path: { type: "string" },
				bytes: { type: "integer" },
				width: { type: "integer" },
				height: { type: "integer" },
				baseline: { type: "string" }
			},
			required: [
				"path",
				"bytes",
				"width",
				"height"
			]
		},
		render: (args, value) => `Saved ${value.bytes} bytes → ${value.path}`,
		timeoutMs: timeout(),
		execute: (args, exec) => screenshotTool(config, args, exec)
	}));
	register(definePlainTool({
		name: "browser_wait",
		description: "等待指定毫秒数(上限 60000),常用于等待页面渲染或请求完成。",
		parameters: {
			type: "object",
			properties: { ms: {
				type: "integer",
				description: "等待毫秒数,默认 1000。"
			} },
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				waitedMs: { type: "integer" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"waitedMs",
				"url",
				"title"
			]
		},
		render: (_args, value) => `Waited ${value.waitedMs}ms`,
		timeoutMs: timeout(),
		execute: (args) => waitTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_back",
		description: "返回上一页(如无历史则无操作)。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				url: { type: "string" },
				title: { type: "string" }
			},
			required: ["url", "title"]
		},
		render: (_args, value) => `Back to: ${value.url}`,
		timeoutMs: timeout(),
		execute: () => backTool(config)
	}));
	register(definePlainTool({
		name: "browser_reload",
		description: "重新加载当前页面。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				url: { type: "string" },
				title: { type: "string" }
			},
			required: ["url", "title"]
		},
		render: (_args, value) => `Reloaded: ${value.url}`,
		timeoutMs: timeout(),
		execute: () => reloadTool(config)
	}));
	register(definePlainTool({
		name: "browser_status",
		description: "查看浏览器会话是否打开、当前 URL 与标题。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				open: { type: "boolean" },
				profile: { type: "string" },
				channel: { type: "string" },
				tabs: { type: "integer" },
				profiles: {
					type: "array",
					items: { type: "object" }
				},
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"open",
				"profile",
				"channel",
				"tabs",
				"profiles"
			]
		},
		render: (_args, value) => value.open ? `Open (${value.channel}): ${value.url} — ${value.title}` : "Not open",
		timeoutMs: timeout(),
		execute: () => statusTool()
	}));
	register(definePlainTool({
		name: "browser_close",
		description: "关闭浏览器会话并释放资源;下次使用工具时会自动重新打开。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: { closed: { type: "boolean" } },
			required: ["closed"]
		},
		render: () => "Browser closed",
		execute: () => closeTool()
	}));
	register(definePlainTool({
		name: "browser_tabs",
		description: "管理浏览器多标签页:list 列出所有标签,new 新建(可选带 url),switch 按 id 或 index 切换,close 关闭指定标签。id 来自 list 结果。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"list",
						"new",
						"switch",
						"close"
					]
				},
				url: {
					type: "string",
					description: "new 时打开的新标签 URL。"
				},
				id: {
					type: "integer",
					description: "目标标签 id(list 返回)。"
				},
				index: {
					type: "integer",
					description: "目标标签序号(0 起)。"
				},
				waitUntil: {
					type: "string",
					enum: [
						"load",
						"domcontentloaded",
						"commit"
					]
				},
				timeoutMs: { type: "integer" }
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string" },
				tab: { type: "object" },
				tabs: {
					type: "array",
					items: { type: "object" }
				},
				activeId: { type: "integer" }
			},
			required: [
				"action",
				"tabs",
				"activeId"
			]
		},
		render: (args, value) => {
			const lines = value.tabs.map((t) => `${t.id === value.activeId ? "▶" : " "} #${t.id} ${t.url}${t.title ? ` — ${t.title}` : ""}`);
			return `tabs ${value.action}: ${lines.join("\n") || "(none)"}`;
		},
		timeoutMs: timeout(),
		execute: (args) => tabsTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_download",
		description: "获取页面上最近触发的下载(如点击下载链接后),保存到工作区 .dsh-browser/downloads/ 并返回路径。index 可选,默认最近一次;wait=true 时先轮询等待新下载出现(以调用时刻为基线,默认等 10 秒),避免 browser_wait 盲等;浏览器会话关闭后下载记录丢失。",
		parameters: {
			type: "object",
			properties: {
				index: {
					type: "integer",
					description: "下载记录序号(0 起,默认最近)。"
				},
				wait: {
					type: "boolean",
					description: "等待新下载出现再取,默认 false。"
				},
				timeoutMs: {
					type: "integer",
					description: "wait 超时毫秒,默认 10000,上限 60000。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				path: { type: "string" },
				filename: { type: "string" },
				url: { type: "string" },
				bytes: { type: "integer" }
			},
			required: [
				"path",
				"filename",
				"url",
				"bytes"
			]
		},
		render: (_args, value) => `Downloaded ${value.filename} (${value.bytes} bytes) → ${value.path}`,
		timeoutMs: timeout(),
		execute: (args, exec) => downloadTool(config, args, exec)
	}));
	register(definePlainTool({
		name: "browser_upload",
		description: "把本地文件上传到页面的文件输入框(selector 指向 input[type=file])。path 可以是绝对路径或相对工作区的路径。",
		parameters: {
			type: "object",
			properties: {
				selector: {
					type: "string",
					description: "文件输入框的 CSS 选择器。"
				},
				path: {
					type: "string",
					description: "要上传的文件路径。"
				},
				timeoutMs: { type: "integer" }
			},
			required: ["selector", "path"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				uploaded: { type: "string" },
				bytes: { type: "integer" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"uploaded",
				"bytes",
				"url",
				"title"
			]
		},
		render: (args, value) => `Uploaded ${value.uploaded} (${value.bytes} bytes) to ${args.selector}`,
		timeoutMs: timeout(),
		execute: (args, exec) => uploadTool(config, args, exec)
	}));
	register(definePlainTool({
		name: "browser_cookies",
		description: "管理浏览器 Cookie:list 列出当前页面域名的 Cookie(默认隐藏值,showValues=true 显示),set 设置一个 Cookie(可指定 url,默认当前页面),clear 清空全部。用于处理登录态。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"list",
						"set",
						"clear"
					]
				},
				url: {
					type: "string",
					description: "list 的过滤域名或 set 的归属 URL。"
				},
				name: {
					type: "string",
					description: "set 时的 Cookie 名。"
				},
				value: {
					type: "string",
					description: "set 时的 Cookie 值。"
				},
				showValues: { type: "boolean" }
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				cookies: {
					type: "array",
					items: { type: "object" }
				},
				set: { type: "boolean" },
				cleared: { type: "boolean" },
				name: { type: "string" },
				url: { type: "string" }
			},
			required: []
		},
		render: (_args, value) => {
			if (value.cleared) return "All cookies cleared";
			if (value.set) return `Cookie ${value.name} set for ${value.url}`;
			return (value.cookies ?? []).map((c) => `${c.name}=${c.value} (${c.domain}${c.path}, httpOnly=${c.httpOnly})`).join("\n") || "(no cookies)";
		},
		timeoutMs: timeout(),
		execute: (args) => cookiesTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_form",
		description: "批量填充表单:fields 数组,每项给 selector(CSS)或 label(可见文本)与 value;submit=true 时填完按回车提交。也可 from=<已保存表单名> 回放(browser_form_save 保存)。先 browser_elements 或 browser_snapshot 了解表单结构。",
		parameters: {
			type: "object",
			properties: {
				fields: {
					type: "array",
					items: {
						type: "object",
						properties: {
							selector: { type: "string" },
							label: { type: "string" },
							value: { type: "string" }
						}
					},
					description: "要填充的字段列表(from 回放时省略)。"
				},
				from: {
					type: "string",
					description: "回放已保存表单的名称。"
				},
				submit: { type: "boolean" },
				timeoutMs: { type: "integer" }
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				filled: {
					type: "array",
					items: { type: "object" }
				},
				submit: { type: "boolean" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"filled",
				"submit",
				"url",
				"title"
			]
		},
		render: (args, value) => `Filled ${value.filled.length} field(s)${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args) => formTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_form_save",
		description: "把最近一次 browser_form 填充的字段保存为命名表单(或直接传 fields),之后 browser_form 用 from=<name> 一键回放。",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "表单名(回放时用)。"
				},
				fields: {
					type: "array",
					items: { type: "object" },
					description: "可选,不传则用最近一次填充。"
				}
			},
			required: ["name"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				saved: { type: "string" },
				fields: { type: "integer" }
			},
			required: ["saved", "fields"]
		},
		render: (_args, value) => `Saved form "${value.saved}" with ${value.fields} field(s)`,
		timeoutMs: timeout(),
		execute: (args) => formSaveTool(args)
	}));
	register(definePlainTool({
		name: "browser_forms",
		description: "管理已保存的表单回放:list 列出,delete 删除指定表单。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "delete"]
				},
				name: {
					type: "string",
					description: "delete 时的表单名。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				forms: {
					type: "array",
					items: { type: "object" }
				},
				deleted: { type: "boolean" },
				name: { type: "string" }
			},
			required: []
		},
		render: (args, value) => {
			if (args.action === "delete") return value.deleted ? `Deleted "${value.name}"` : `No form "${value.name}"`;
			return (value.forms ?? []).map((f) => `"${f.name}" (${f.fields} fields): ${f.preview}`).join("\n") || "(no saved forms)";
		},
		timeoutMs: timeout(),
		execute: (args) => formsTool(args)
	}));
	register(definePlainTool({
		name: "browser_profile",
		description: "多浏览器配置文件:list 列出配置的 profiles(work/personal…)与当前会话状态,use <name> 切换当前 profile(后续浏览器工具作用于该 profile)。每个 profile 可配置独立 userDataDir(登录态隔离)。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "use"]
				},
				name: {
					type: "string",
					description: "use 时的 profile 名(default 或配置的)。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				current: { type: "string" },
				profiles: {
					type: "array",
					items: { type: "object" }
				}
			},
			required: ["current", "profiles"]
		},
		render: (args, value) => {
			if (args.action === "use") return `Switched to profile "${value.current}"`;
			return value.profiles.map((p) => `${p.name === value.current ? "▶" : " "} ${p.name}${p.open ? ` (open, ${p.tabs} tabs${p.persistent ? ", persistent" : ""})` : " (closed)"}${p.userDataDir ? ` → ${p.userDataDir}` : ""}`).join("\n") || "(no profiles configured)";
		},
		timeoutMs: timeout(),
		execute: (args) => profileTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_wait_for_login",
		description: "等待人工登录完成。agent 在登录页调用本工具后,提示用户在浏览器窗口中完成登录(有头模式 headless:false 时用户可直接操作;配 userDataDir 登录态会持久化)。成功条件三选一:successSelector(登录后出现的元素,如 '#avatar')或 successUrl(登录后 URL 正则,如 'https://\\\\.app\\\\.example\\\\.com')都不给则 URL 发生变化即视为完成。轮询间隔 2 秒,超时返回 loggedIn:false。",
		parameters: {
			type: "object",
			properties: {
				timeoutMs: {
					type: "integer",
					description: "等待上限(毫秒,默认 120000,上限 600000)。"
				},
				successSelector: {
					type: "string",
					description: "登录成功后应出现的 CSS 选择器。"
				},
				successUrl: {
					type: "string",
					description: "登录成功后 URL 应匹配的正则。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				loggedIn: { type: "boolean" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"loggedIn",
				"url",
				"title"
			]
		},
		render: (_args, value) => value.loggedIn ? `登录完成: ${value.url}` : `等待登录超时,仍在: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args) => waitForLoginTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_elements",
		description: "列出当前页面可交互元素(input/textarea/select/button/链接)的结构化清单:类型、name/id、关联 label(aria-label/label[for]/form-item)、placeholder、可见文本、可直接用于 browser_click/browser_type/browser_select 的 CSS 选择器。页面有展开的下拉时,dropdownOptions 会列出可见选项。比 browser_snapshot 更适合定位表单。",
		parameters: {
			type: "object",
			properties: { max: {
				type: "integer",
				description: "最多返回多少元素,默认 60。"
			} },
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				count: { type: "integer" },
				elements: {
					type: "array",
					items: { type: "object" }
				},
				dropdownOptions: {
					type: "array",
					items: { type: "string" }
				}
			},
			required: [
				"count",
				"elements",
				"dropdownOptions"
			]
		},
		render: (_args, value) => {
			const lines = (value.elements ?? []).map((e) => `<${e.tag}${e.type ? ` type=${e.type}` : ""}>${e.name ? ` name=${e.name}` : ""}${e.id ? ` id=${e.id}` : ""}${e.label ? ` label="${e.label}"` : ""}${e.placeholder ? ` ph="${e.placeholder}"` : ""}${e.text ? ` "${e.text.slice(0, 40)}"` : ""}${e.selector ? ` → ${e.selector}` : ""}`);
			if ((value.dropdownOptions ?? []).length > 0) lines.push(`--- 展开的下拉选项 ---`, ...value.dropdownOptions.map((o) => `  ${o}`));
			return lines.join("\n") || "(no interactive elements)";
		},
		timeoutMs: timeout(),
		execute: (args) => elementsTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_wait_for",
		description: "通用显式等待(测试同步原语):轮询直到条件成立或超时抛错。condition 四类:1) {selector:'#btn', state:'visible|hidden|attached|detached'} 元素状态(默认 visible);2) {url:'正则字符串'} 当前 URL 匹配;3) {text:'子串'} 页面可见文本包含;4) {count:{selector,op:'eq|gt|gte|lt|lte',value}} 元素数量比较;5) {eval:'JS 表达式'} 求值 truthy。用于等页面渲染、等请求完成、等元素出现。",
		parameters: {
			type: "object",
			properties: {
				condition: {
					type: "object",
					description: "等待条件(见描述,五选一)。"
				},
				timeoutMs: {
					type: "integer",
					description: "超时毫秒,默认 10000,上限 120000。"
				},
				intervalMs: {
					type: "integer",
					description: "轮询间隔毫秒,默认 500。"
				}
			},
			required: ["condition"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				met: { type: "boolean" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"met",
				"url",
				"title"
			]
		},
		render: (_args, value) => `等待条件满足: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args) => waitForTool(config, args)
	}));
	register(definePlainTool({
		name: "browser_assert",
		description: "结构化断言(测试核心):condition 在 timeoutMs 内成立则通过(条件格式同 browser_wait_for,另支持 ref)。失败时自动截图存证据目录(assert-fail-*.png)并抛错,错误消息含原因与截图路径。另支持视觉回归:传 visual={baseline, threshold?, maxDiffRatio?, mask?} 与基线截图做像素比对(browser_screenshot 的 baseline 建立基线;mask 为忽略的选择器数组,如时钟/广告位),失败时产出当前截图与红标 diff 图。适合断言登录成功、关键元素出现、接口返回、文本正确、页面无视觉回归。",
		parameters: {
			type: "object",
			properties: {
				condition: {
					type: "object",
					description: "断言条件(同 browser_wait_for,另支持 {ref, state})。"
				},
				visual: {
					type: "object",
					description: "视觉断言:{ baseline: 基线名, threshold?: 像素亮度阈值(默认0.1), maxDiffRatio?: 允许的差异像素比例(默认0.005), mask?: 忽略区域选择器数组 }。"
				},
				timeoutMs: {
					type: "integer",
					description: "断言超时毫秒,默认 5000,上限 60000。"
				},
				intervalMs: {
					type: "integer",
					description: "轮询间隔毫秒,默认 300。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				passed: { type: "boolean" },
				url: { type: "string" },
				title: { type: "string" },
				visual: { type: "object" }
			},
			required: [
				"passed",
				"url",
				"title"
			]
		},
		render: (_args, value) => `断言通过: ${value.url}`,
		timeoutMs: timeout(),
		execute: (args, exec) => assertTool(config, args, exec)
	}));
	register(definePlainTool({
		name: "browser_network",
		description: "网络记录查询(自动记录页面 XHR/fetch 接口请求,含请求/响应体截断存储,每 profile 上限 500 条)。action:list 列出(可按 urlSubstr/method/status 过滤,limit 默认 50);failed 只列失败/4xx5xx;wait 等待某个 url 正则匹配的接口出现(带 timeoutMs,命中返回 waitMs);stats 按 host 聚合计数/失败数/平均耗时/状态码分布;clear 清空记录。适合断言接口出入参、排查 4xx/5xx。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"list",
						"failed",
						"wait",
						"stats",
						"clear"
					],
					description: "默认 list。"
				},
				urlSubstr: {
					type: "string",
					description: "URL 子串过滤(list/failed)。"
				},
				method: {
					type: "string",
					description: "HTTP 方法过滤(list/failed)。"
				},
				status: {
					type: "integer",
					description: "状态码过滤(list/failed)。"
				},
				limit: {
					type: "integer",
					description: "返回条数上限,默认 50。"
				},
				url: {
					type: "string",
					description: "wait 时的 URL 正则。"
				},
				timeoutMs: {
					type: "integer",
					description: "wait 超时毫秒,默认 10000。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				entries: {
					type: "array",
					items: { type: "object" }
				},
				failed: {
					type: "array",
					items: { type: "object" }
				},
				stats: {
					type: "array",
					items: { type: "object" }
				},
				matched: { type: "object" },
				waitMs: { type: "integer" },
				cleared: { type: "boolean" }
			},
			required: []
		},
		render: (_args, value) => {
			if (value.cleared) return "网络记录已清空";
			if (value.stats) return value.stats.map((s) => `${s.host}  共${s.total} 失败${s.failed} 均耗时${s.avgMs ?? "-"}ms  ${JSON.stringify(s.byStatus)}`).join("\n") || "(无记录)";
			return (value.entries ?? value.failed ?? (value.matched ? [value.matched] : [])).map((e) => {
				const head = `${e.method} ${e.url} → ${e.failed ? "FAILED" : e.ok ? e.status : e.status + " !"}${e.durationMs !== void 0 ? ` ${e.durationMs}ms` : ""}`;
				const reqBody = e.postData ? `\n  req: ${String(e.postData).slice(0, 160)}` : "";
				const resBody = e.body ? `\n  res: ${String(e.body).slice(0, 240)}` : "";
				return head + reqBody + resBody;
			}).join("\n") || "(无记录)";
		},
		timeoutMs: timeout(),
		execute: (args) => networkTool(args)
	}));
	register(definePlainTool({
		name: "browser_record",
		description: "操作录制(回归测试数据源):start 开始录制(后续浏览器工具调用自动记录,selector 步骤附带元素指纹),stop 结束并返回步数,save <name> 保存(start→stop 的录制 buffer 优先,否则取最近 100 次调用;stripReads=true 剔除只读探查步骤;vars 可把指定步骤字段抽成 {{占位符}} 实现参数化回放;upload 引用的本地文件缺失时返回 warnings),list/delete 管理。配合 browser_replay 一键回放。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"start",
						"stop",
						"save",
						"list",
						"delete"
					],
					description: "默认 start。"
				},
				name: {
					type: "string",
					description: "save/delete 时的录制名。"
				},
				stripReads: {
					type: "boolean",
					description: "save 时剔除只读步骤(snapshot/elements/eval/network/status/cookies list),默认 false。"
				},
				vars: {
					type: "object",
					description: "save 时参数化:{ 变量名: \"#步骤号.args.字段\" }(步骤号 1 起),该字段值替换为 {{变量名}} 占位符;replay 时用 vars 传入真实值。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				recording: { type: "boolean" },
				steps: { type: "integer" },
				stripped: { type: "integer" },
				varsApplied: { type: "integer" },
				saved: { type: "string" },
				source: { type: "string" },
				file: { type: "string" },
				warnings: {
					type: "array",
					items: { type: "string" }
				},
				recordings: {
					type: "array",
					items: { type: "object" }
				},
				deleted: { type: "boolean" },
				name: { type: "string" },
				hint: { type: "string" }
			},
			required: []
		},
		render: (args, value) => {
			if (args.action === "start") return "开始录制(后续浏览器调用将记录)";
			if (args.action === "stop") return `录制结束,共 ${value.steps} 步(browser_record save <name> 保存)`;
			if (args.action === "save") {
				const warn = (value.warnings ?? []).length > 0 ? `\n⚠️ ${value.warnings.join("\n⚠️ ")}` : "";
				const stripped = typeof value.stripped === "number" ? `(已剔除 ${value.stripped} 个只读步骤)` : "";
				const vars = typeof value.varsApplied === "number" ? `(参数化 ${value.varsApplied} 个变量)` : "";
				return `已保存录制 "${value.saved}"(${value.steps} 步,来源: ${value.source === "recording" ? "start→stop 录制" : "最近操作轨迹"})${stripped}${vars}${warn}`;
			}
			if (args.action === "delete") return value.deleted ? `已删除 "${value.name}"` : `无此录制 "${value.name}"`;
			return (value.recordings ?? []).map((r) => `"${r.name}"(${r.steps} 步): ${r.preview}`).join("\n") || "(无录制)";
		},
		timeoutMs: timeout(),
		execute: (args) => recordTool(args)
	}));
	register(definePlainTool({
		name: "browser_replay",
		description: "回放录制或步骤序列(回归测试):name 指定已保存录制(browser_record save),或直接传 steps 数组(每步 {tool, args})。failFast 默认 true(遇错停止);返回每步结果与汇总。选择器自愈:录制时保存了元素指纹的步骤,原 selector 失败时自动按 testid→role+name→text→id 降级重试并在结果中标 healed(建议事后修复录制选择器)。参数化:录制含 {{占位符}} 时用 vars 注入;data 传对象数组或 dataFile 传 CSV 路径(首行为变量名)可逐行数据驱动回放。运行结果自动记入回归历史(browser_report 可导出报告)。",
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "已保存录制名(与 steps 二选一)。"
				},
				steps: {
					type: "array",
					items: { type: "object" },
					description: "步骤数组 [{tool, args}](可含 meta.hint 指纹)。"
				},
				failFast: {
					type: "boolean",
					description: "遇错即停,默认 true(data 模式为行内 failFast,不中断后续行)。"
				},
				vars: {
					type: "object",
					description: "{{占位符}} 的注入值,如 { username: \"a@x.com\" }。"
				},
				data: {
					type: "array",
					items: { type: "object" },
					description: "数据集:每行一个对象,逐行回放一次。"
				},
				dataFile: {
					type: "string",
					description: "数据集 CSV 文件(工作区相对路径,首行为变量名)。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				source: { type: "string" },
				total: { type: "integer" },
				passed: { type: "integer" },
				failed: { type: "integer" },
				healedCount: { type: "integer" },
				stoppedAt: { type: "integer" },
				results: {
					type: "array",
					items: { type: "object" }
				},
				summary: { type: "string" },
				rows: { type: "integer" },
				passedRows: { type: "integer" },
				failedRows: { type: "integer" },
				runs: {
					type: "array",
					items: { type: "object" }
				}
			},
			required: [
				"source",
				"total",
				"passed",
				"failed",
				"healedCount",
				"results",
				"summary"
			]
		},
		render: (_args, value) => {
			return value.runs !== void 0 ? `${value.summary}\n${value.runs.map((r) => `${(r.failed ?? 0) === 0 ? "✓" : "✗"} 行${r.row}${r.error ? ` — ${String(r.error).slice(0, 100)}` : ` ${r.passed}/${r.total}`}`).join("\n")}` : `${value.summary}\n${(value.results ?? []).map((r) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.healed ? ` [自愈:${r.via}]` : ""}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`;
		},
		timeoutMs: timeout(),
		execute: (args, exec) => replayTool(args, stepImpls, config, exec)
	}));
	register(definePlainTool({
		name: "browser_batch",
		description: "动作批处理:一次调用顺序执行多个浏览器步骤 [{tool, args}](内核同 browser_replay),减少「点击→等待→输入→回车」类固定小序列的往返。failFast 默认 true(遇错停);步骤内禁止嵌套 browser_batch/browser_replay/browser_record;批整体在操作轨迹/录制里记为单条步骤(可录制、可回放)。",
		parameters: {
			type: "object",
			properties: {
				steps: {
					type: "array",
					items: { type: "object" },
					description: "步骤数组 [{tool, args}]。"
				},
				failFast: {
					type: "boolean",
					description: "遇错即停,默认 true。"
				}
			},
			required: ["steps"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				total: { type: "integer" },
				passed: { type: "integer" },
				failed: { type: "integer" },
				healedCount: { type: "integer" },
				stoppedAt: { type: "integer" },
				results: {
					type: "array",
					items: { type: "object" }
				},
				summary: { type: "string" }
			},
			required: [
				"total",
				"passed",
				"failed",
				"healedCount",
				"results",
				"summary"
			]
		},
		render: (_args, value) => `${value.summary}\n${(value.results ?? []).map((r) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`,
		timeoutMs: timeout(),
		execute: (args) => batchTool(args, stepImpls)
	}));
	register(definePlainTool({
		name: "browser_extract",
		description: "规则化结构化抽取(网站信息获取):fields 定义抽取结构 [{name, selector, attr?, multiple?, fields?}](attr 缺省取可见文本,可指定 href/src 等属性;multiple=true 收集所有命中;fields 嵌套可在行内抽子字段);next 传翻页选择器自动翻页聚合(maxPages 上限,next 消失/禁用即停);format 支持 json/csv/jsonl/markdown,file 落盘到工作区(自动按扩展名推断格式,拒绝路径穿越)。语义化抽取(如「总结要点」)不在此工具范围——用 browser_snapshot 读文本后交 jev_extract。",
		parameters: {
			type: "object",
			properties: {
				fields: {
					type: "array",
					items: { type: "object" },
					description: "抽取字段定义 [{name, selector, attr?, multiple?, fields?}]。"
				},
				next: {
					type: "string",
					description: "翻页「下一页」选择器(可选)。"
				},
				maxPages: {
					type: "integer",
					description: "翻页上限,默认 1,上限 100。"
				},
				waitAfterMs: {
					type: "integer",
					description: "翻页后等待毫秒,默认 800。"
				},
				maxRows: {
					type: "integer",
					description: "聚合行数上限,默认 1000。"
				},
				format: {
					type: "string",
					enum: [
						"json",
						"csv",
						"jsonl",
						"markdown"
					],
					description: "序列化格式(默认 json;file 有扩展名时自动推断)。"
				},
				file: {
					type: "string",
					description: "落盘路径(工作区相对或绝对,限工作区内)。"
				}
			},
			required: ["fields"],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				rows: {
					type: "array",
					items: { type: "object" }
				},
				count: { type: "integer" },
				pages: { type: "integer" },
				format: { type: "string" },
				truncated: { type: "boolean" },
				file: { type: "string" },
				bytes: { type: "integer" },
				url: { type: "string" },
				title: { type: "string" }
			},
			required: [
				"rows",
				"count",
				"pages",
				"format",
				"truncated",
				"url",
				"title"
			]
		},
		render: (_args, value) => `抽取 ${value.count} 行 / ${value.pages} 页${value.truncated ? "(已截断)" : ""}${value.file ? ` → ${value.file} (${value.bytes} bytes)` : ""}`,
		timeoutMs: timeout(),
		execute: (args, exec) => extractTool(config, args, exec)
	}));
	register(definePlainTool({
		name: "browser_report",
		description: "回归运行报告:每次 browser_replay / browser_batch 的结果自动记入运行历史。action=list 列出最近运行;show 查看单条详情(runId 省略取最近一条);export 聚合生成报告落盘工作区(format=markdown|html,含运行趋势、失败步骤 Top、自愈步骤清单,source 可只看某个录制)。配合 DSH 的 schedule 能力可实现定时回归+定期报告。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: [
						"list",
						"show",
						"export"
					],
					description: "默认 list。"
				},
				runId: {
					type: "string",
					description: "show 时的运行 id(省略取最近一条)。"
				},
				format: {
					type: "string",
					enum: ["markdown", "html"],
					description: "export 格式,默认 markdown。"
				},
				source: {
					type: "string",
					description: "export 时只聚合该来源(录制名)的运行。"
				},
				file: {
					type: "string",
					description: "export 落盘路径(工作区内,默认 reports/regression-<日期>.md)。"
				},
				limit: {
					type: "integer",
					description: "list/export 聚合的运行条数上限,list 默认 20、export 默认 50。"
				}
			},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				runs: {},
				run: { type: "object" },
				file: { type: "string" },
				bytes: { type: "integer" },
				format: { type: "string" }
			},
			required: []
		},
		render: (args, value) => {
			if (args.action === "export") return `已导出 ${value.runs} 次运行 → ${value.file} (${value.bytes} bytes, ${value.format})`;
			if (args.action === "show") {
				const r = value.run ?? {};
				return `${r.source}${r.row !== void 0 ? ` 行${r.row}` : ""}: ${r.passed}/${r.total} 通过,自愈 ${r.healedCount},runId=${r.runId}`;
			}
			return (value.runs ?? []).map((r) => `${r.failed === 0 ? "✓" : "✗"} ${new Date(r.ts).toLocaleString("zh-CN", { hour12: false })} ${r.source}${r.row !== void 0 ? ` 行${r.row}` : ""}: ${r.passed}/${r.total}${r.healedCount > 0 ? ` (自愈${r.healedCount})` : ""}`).join("\n") || "(暂无运行记录)";
		},
		timeoutMs: timeout(),
		execute: (args, exec) => reportTool(config, args, exec)
	}));
}
//#endregion
//#region lib/types/browser/ui.js
function registerBrowserApi(ctx, config, base) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return;
	const disposers = [];
	disposers.push(webServer.register({
		kind: "prefix",
		path: base,
		handler: async (req, res) => {
			const path = urlPath(req);
			if (path === `${base}/status`) {
				sendJson(res, 200, await statusTool());
				return;
			}
			if (path === `${base}/history`) {
				sendJson(res, 200, {
					profile: currentProfile,
					history: [...historyOf(currentProfile)].reverse()
				});
				return;
			}
			if (path === `${base}/log`) {
				sendJson(res, 200, {
					profile: currentProfile,
					calls: testLogOf().slice(0, 50)
				});
				return;
			}
			if (path === `${base}/runs/latest`) {
				sendJson(res, 200, { run: latestRun() });
				return;
			}
			if (path === `${base}/recordings`) {
				if ((req.method ?? "GET") === "POST") {
					const body = await readJsonBody(req).catch(() => void 0);
					const name = typeof body?.name === "string" ? body.name : "";
					if (!name) {
						sendText(res, 400, "name required");
						return;
					}
					sendJson(res, 200, {
						deleted: deleteRecording(name),
						name
					});
					return;
				}
				sendJson(res, 200, { recordings: listRecordings() });
				return;
			}
			if (path === `${base}/recordings/detail`) {
				let name = "";
				try {
					name = new URL(req.url ?? "/", "http://x").searchParams.get("name") ?? "";
				} catch {}
				const detail = recordingDetail(name);
				if (detail === void 0) {
					sendText(res, 404, `no recording ${name}`);
					return;
				}
				sendJson(res, 200, detail);
				return;
			}
			if (path === `${base}/screenshot`) {
				const page = activePage();
				if (page === null || page.isClosed()) {
					sendText(res, 404, "browser not open");
					return;
				}
				try {
					const buffer = await page.screenshot({ type: "png" });
					res.writeHead(200, {
						"content-type": "image/png",
						"cache-control": "no-store",
						"content-length": buffer.length
					});
					res.end(buffer);
				} catch (error) {
					sendText(res, 500, `screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
				}
				return;
			}
			sendText(res, 404, "not found");
		}
	}));
	ctx.effect(() => () => {
		for (const dispose of disposers) try {
			dispose();
		} catch {}
	});
}
//#endregion
//#region lib/types/embed.js
/** 面板嵌入 + 实时画面 API 共用基路径。 */
function embedJs(base) {
	return `(function () {
  "use strict";
  var B = ${JSON.stringify(base)};

  // —— 挂载(等 body 就绪) ——
  var root = null, btn = null, panel = null, open = false, shot = null;
  var modal = null, mTitle = null, mShot = null, mHistory = null, mEmpty = null, modalOpen = false;
  var opsBox = null;

  function css() {
    var s = document.createElement("style");
    s.textContent = [
      "#dsh-browser-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:40px;height:40px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 4px 16px var(--dsw-alias-bg-mask-2);transition:background .15s ease}",
      "#dsh-browser-fab:hover{background:var(--dsw-alias-button-floating-hover)}",
      "#dsh-browser-panel,#dsh-browser-panel *,.dsh-browser-modal-box,.dsh-browser-modal-box *{box-sizing:border-box}",
      "#dsh-browser-panel{position:fixed;right:16px;bottom:64px;z-index:2147483000;width:320px;max-height:70vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;display:none;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:0 8px 32px var(--dsw-alias-bg-mask-2);padding:12px}",
      "#dsh-browser-panel::-webkit-scrollbar{display:none}",
      "#dsh-browser-panel.open{display:flex}",
      ".dsh-browser-row{display:flex;align-items:center;gap:8px;padding:6px 0}",
      ".dsh-browser-dot{width:8px;height:8px;border-radius:999px;background:var(--dsw-alias-label-dimmed);flex:none}",
      ".dsh-browser-dot.ok{background:var(--dsw-alias-state-success-primary)}",
      ".dsh-browser-dot.bad{background:var(--dsw-alias-state-error-primary)}",
      ".dsh-browser-label{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".dsh-browser-value{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}",
      ".dsh-browser-shot{width:100%;display:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}",
      ".dsh-browser-shot.on{display:block}",
      ".dsh-browser-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;display:none}",
      ".dsh-browser-hint.on{display:block}",
      ".dsh-browser-modal{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-2)}",
      ".dsh-browser-modal.open{display:flex}",
      ".dsh-browser-modal-box{width:min(1200px,100%);max-height:90vh;display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-menu);padding:12px;box-shadow:0 16px 64px var(--dsw-alias-bg-mask-2)}",
      ".dsh-browser-modal-head{display:flex;align-items:center;gap:8px}",
      ".dsh-browser-modal-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}",
      ".dsh-browser-modal-close{width:28px;height:28px;flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1}",
      ".dsh-browser-modal-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-modal-shot{width:100%;max-height:58vh;object-fit:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}",
      ".dsh-browser-modal-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;padding:24px 0}",
      ".dsh-browser-history{display:none;flex-direction:column;gap:2px;max-height:24vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;border-top:1px solid var(--dsw-alias-border-l2);padding-top:8px}",
      ".dsh-browser-history::-webkit-scrollbar{display:none}",
      ".dsh-browser-history.on{display:flex}",
      ".dsh-browser-history-title{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-bottom:4px}",
      ".dsh-browser-history a{display:flex;gap:8px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;text-decoration:none;border-radius:8px;padding:6px 8px;white-space:nowrap;overflow:hidden}",
      ".dsh-browser-history a:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-history .t{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px}",
      ".dsh-browser-history .u{overflow:hidden;text-overflow:ellipsis}",
      ".dsh-browser-ops{display:none;flex-direction:column;gap:2px;max-height:20vh;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;border-top:1px solid var(--dsw-alias-border-l2);padding-top:6px;margin-top:2px}",
      ".dsh-browser-ops::-webkit-scrollbar{display:none}",
      ".dsh-browser-ops.on{display:flex}",
      ".dsh-browser-ops-title{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-bottom:2px}",
      ".dsh-browser-op{display:flex;gap:6px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 4px}",
      ".dsh-browser-op .ok{color:var(--dsw-alias-state-success-primary);flex:none}",
      ".dsh-browser-op .fail{color:var(--dsw-alias-state-error-primary);flex:none}",
      ".dsh-browser-op .t{color:var(--dsw-alias-label-tertiary);flex:none}",
      ".dsh-browser-op .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ].join("\\n");
    document.head.appendChild(s);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function probe(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.ok ? r : null; })
      .catch(function () { return null; });
  }
  function fmtTime(ts) {
    var d = new Date(ts);
    var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }
  // —— 大屏模态框:点面板缩略图打开,2 秒轮询实时画面 + 访问历史 ——
  function renderHistory(list) {
    mHistory.innerHTML = "";
    if (!list || list.length === 0) { mHistory.className = "dsh-browser-history"; return; }
    mHistory.className = "dsh-browser-history on";
    mHistory.appendChild(el("div", "dsh-browser-history-title", "访问历史(" + list.length + " 条,点击在新标签打开)"));
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var a = document.createElement("a");
      a.href = e.url; a.target = "_blank"; a.rel = "noopener";
      if (e.title) a.title = e.title;
      a.appendChild(el("span", "t", fmtTime(e.ts)));
      a.appendChild(el("span", "u", (e.title || e.url).slice(0, 100)));
      mHistory.appendChild(a);
    }
  }
  function renderOps(list) {
    if (!opsBox) return;
    opsBox.innerHTML = "";
    if (!list || list.length === 0) { opsBox.className = "dsh-browser-ops"; return; }
    opsBox.className = "dsh-browser-ops on";
    opsBox.appendChild(el("div", "dsh-browser-ops-title", "最近操作(" + Math.min(list.length, 8) + " 条)"));
    var slice = list.slice(0, 8);
    for (var i = 0; i < slice.length; i++) {
      var op = slice[i];
      var row = el("div", "dsh-browser-op");
      row.appendChild(el("span", op.ok ? "ok" : "fail", op.ok ? "✓" : "✗"));
      row.appendChild(el("span", "t", fmtTime(op.ts)));
      var desc = op.tool + (op.error ? ": " + op.error : "");
      var nameEl = el("span", "n", desc);
      nameEl.title = desc;
      row.appendChild(nameEl);
      opsBox.appendChild(row);
    }
  }
  function modalRefresh() {
    if (!modalOpen) return;
    probe(B + "/status").then(function (r) {
      if (r === null) {
        mEmpty.style.display = "block"; mEmpty.textContent = "连接失败";
        mShot.style.display = "none"; mTitle.textContent = "浏览器实时画面";
        return;
      }
      return r.json().then(function (s) {
        if (!s.open) {
          mEmpty.style.display = "block"; mEmpty.textContent = "浏览器尚未打开。让 agent 调用 browser_open。";
          mShot.style.display = "none"; mTitle.textContent = "浏览器实时画面";
        } else {
          mEmpty.style.display = "none"; mShot.style.display = "block";
          mTitle.textContent = (s.url || "(空白页)") + " — " + (s.title || "");
          mShot.src = B + "/screenshot?v=" + Date.now();
        }
      });
    }).catch(function () {});
    probe(B + "/history").then(function (r) {
      if (r !== null) r.json().then(function (h) { renderHistory(h.history || []); }).catch(function () {});
    }).catch(function () {});
    setTimeout(modalRefresh, 2000);
  }
  function openModal() {
    if (modal === null) return;
    modalOpen = true;
    modal.className = "dsh-browser-modal open";
    modalRefresh();
  }
  function closeModal() {
    modalOpen = false;
    if (modal !== null) modal.className = "dsh-browser-modal";
  }
  function buildModal() {
    modal = el("div", "dsh-browser-modal");
    var box = el("div", "dsh-browser-modal-box");
    var head = el("div", "dsh-browser-modal-head");
    mTitle = el("span", "dsh-browser-modal-title", "浏览器实时画面");
    head.appendChild(mTitle);
    var close = el("button", "dsh-browser-modal-close", "✕");
    close.addEventListener("click", closeModal);
    head.appendChild(close);
    mEmpty = el("div", "dsh-browser-modal-empty", "浏览器尚未打开");
    mShot = el("img", "dsh-browser-modal-shot"); mShot.alt = "browser"; mShot.style.display = "none";
    mHistory = el("div", "dsh-browser-history");
    box.appendChild(head); box.appendChild(mEmpty); box.appendChild(mShot); box.appendChild(mHistory);
    modal.appendChild(box);
    modal.addEventListener("click", function (ev) { if (ev.target === modal) closeModal(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeModal(); });
    root.appendChild(modal);
  }
  function mount() {
    if (root !== null || document.getElementById("dsh-browser-client-overlay")) return;
    css();
    btn = el("button", null); btn.id = "dsh-browser-fab"; btn.title = "dsh-browser";
    btn.textContent = "🌐";
    panel = el("div", null); panel.id = "dsh-browser-panel";
    function row(id) { var r = el("div", "dsh-browser-row"); var d = el("span", "dsh-browser-dot"); r.appendChild(d); var l = el("span", "dsh-browser-label", id); r.appendChild(l); var v = el("span", "dsh-browser-value", "—"); r.appendChild(v); return { row: r, dot: d, value: v }; }
    var rB = row("浏览器");
    shot = el("img", "dsh-browser-shot"); shot.alt = "browser";
    shot.addEventListener("click", openModal); // 点缩略图 → 大屏模态框
    var hint = el("div", "dsh-browser-hint", "点缩略图看实时画面与访问历史;agent 用 browser_* 工具操作浏览器。");
    opsBox = el("div", "dsh-browser-ops");
    panel.appendChild(rB.row);
    panel.appendChild(shot);
    panel.appendChild(opsBox);
    panel.appendChild(hint);
    btn.addEventListener("click", function () { open = !open; panel.className = open ? "open" : ""; panel.id = "dsh-browser-panel"; });
    root = document.createElement("div");
    root.appendChild(btn); root.appendChild(panel);
    document.body.appendChild(root);
    buildModal();
    function refresh() {
      probe(B + "/status").then(function (r) {
        if (r === null) { rB.dot.className = "dsh-browser-dot bad"; rB.value.textContent = "未启用"; return; }
        r.json().then(function (s) {
          rB.dot.className = "dsh-browser-dot " + (s.open ? "ok" : "bad");
          rB.value.textContent = s.open ? (s.tabs + " 标签 · " + (s.url || "").slice(0, 24)) : "未打开";
          if (open) {
            if (s.open) { shot.className = "dsh-browser-shot on"; shot.src = B + "/screenshot?v=" + Date.now(); hint.className = "dsh-browser-hint"; }
            else { shot.className = "dsh-browser-shot"; hint.className = "dsh-browser-hint on"; }
          }
        }).catch(function () {});
      }).catch(function () {});
      probe(B + "/log").then(function (r) {
        if (r !== null) r.json().then(function (d) { renderOps(d.calls || []); }).catch(function () {});
      }).catch(function () {});
    }
    refresh();
    setInterval(refresh, 5000);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();`;
}
/** 原生 UI 注入:exact 路由提供 embed.js + tapIndex 注入 script 标签。 */
function registerEmbed(webServer, base) {
	const embedPath = `${base}/embed.js`;
	const script = embedJs(base);
	const disposeRoute = webServer.register({
		kind: "exact",
		path: embedPath,
		handler: (req, res) => {
			if ((req.method ?? "GET") !== "GET") {
				sendText(res, 405, "method not allowed");
				return;
			}
			res.writeHead(200, {
				"content-type": "text/javascript; charset=utf-8",
				"cache-control": "no-store",
				"content-length": Buffer.byteLength(script)
			});
			res.end(script);
		}
	});
	const scriptTag = `<script src="${embedPath}" defer><\/script>`;
	const disposeTap = webServer.tapIndex((html) => {
		if (html.includes("dsh-browser")) return html;
		const idx = html.lastIndexOf("</head>");
		if (idx === -1) return html;
		return `${html.slice(0, idx)}${scriptTag}${html.slice(idx)}`;
	});
	return () => {
		try {
			disposeRoute();
			disposeTap();
		} catch {}
	};
}
function applyEmbed(ctx, webServer, base) {
	const dispose = registerEmbed(webServer, base);
	ctx.effect(() => () => {
		try {
			dispose();
		} catch {}
	});
	if (typeof webServer.port === "number") ctx.logger?.info?.(`dsh-browser: native UI widget injected (${base}/embed.js)`);
	return dispose;
}
//#endregion
//#region lib/types/index.js
const name = "dsh-browser-view";
const inject = [];
const SCHEMA = {
	enabled: {
		type: "boolean",
		optional: true
	},
	channel: { type: "string" },
	executablePath: { type: "string" },
	headless: { type: "boolean" },
	userDataDir: { type: "string" },
	profiles: { type: "any" },
	screenshotDir: { type: "string" },
	downloadDir: { type: "string" },
	workspaceDir: { type: "string" },
	screenshotMaxAgeDays: {
		type: "number",
		min: 0
	},
	screenshotMaxCount: {
		type: "number",
		min: 0
	},
	basePath: { type: "string" },
	recordBodies: { type: "boolean" },
	maxTextChars: {
		type: "number",
		min: 1
	},
	maxLinks: {
		type: "number",
		min: 1
	},
	timeoutMs: {
		type: "number",
		min: 1
	},
	baselineDir: { type: "string" },
	selectorHealing: { type: "boolean" },
	healTimeoutMs: {
		type: "number",
		min: 100
	},
	maxRefs: {
		type: "number",
		min: 1
	},
	maxRows: {
		type: "number",
		min: 1
	}
};
const DEFAULT_CONFIG = {
	channel: "auto",
	executablePath: "",
	headless: false,
	userDataDir: "",
	profiles: {},
	screenshotDir: ".dsh-browser/screenshots",
	downloadDir: ".dsh-browser/downloads",
	workspaceDir: "",
	screenshotMaxAgeDays: 7,
	screenshotMaxCount: 200,
	basePath: "/browser",
	recordBodies: true,
	maxTextChars: 2e4,
	maxLinks: 50,
	timeoutMs: 3e4,
	baselineDir: ".dsh-browser/baselines",
	selectorHealing: true,
	healTimeoutMs: 3e3,
	maxRefs: 200,
	maxRows: 1e3
};
function apply(ctx, rawConfig) {
	const resolved = resolveConfig("dsh-browser-view", SCHEMA, DEFAULT_CONFIG, rawConfig);
	if (resolved.enabled === false) return;
	const config = resolved;
	const base = (config.basePath ?? "/browser").replace(/\/+$/, "");
	const loadedRecordings = loadRecordings();
	if (loadedRecordings > 0) ctx.logger?.info?.(`dsh-browser-view: loaded ${loadedRecordings} saved recording(s)`);
	registerTools(ctx, config);
	const sectionDispose = ctx.get("systemPrompt")?.section?.({
		name: "tool:browser",
		order: 200,
		text: "浏览器工具操作一个共享浏览器会话,支持多标签页与多配置文件。打开页面后先用 browser_snapshot 读文本与链接、browser_elements 读表单结构(含关联 label 与展开的下拉选项),再决定 browser_click / browser_type / browser_form;定位操作元素优先用 browser_snapshot { mode: \"aria\" }(可交互元素带 ref=eN,click/type/select/press 直接传 ref 代替 CSS 选择器);下拉选择(原生 select 与 antd/element 组件库)用 browser_select 传 selector/ref + option 文本一步完成;固定小序列(点击→等待→输入→提交)用 browser_batch 一次执行减少往返;标签管理用 browser_tabs;下载用 browser_download(wait=true 可等新下载);登录态用 browser_cookies。做自动化测试时:用 browser_wait_for 显式等待页面稳定/元素出现,用 browser_assert 断言(失败自动截图;visual={baseline} 可做视觉回归,先用 browser_screenshot { baseline } 建基线),用 browser_network 检查接口调用与 4xx/5xx,跑完一轮可用 browser_record save 保存操作序列、browser_replay 回放做回归(选择器失效自动按指纹自愈;vars/data 支持参数化与数据驱动)。每次 replay/batch 都记入运行历史,browser_report list/export 可查看与导出回归报告。抓取结构化数据用 browser_extract(fields 定义 CSS 字段,可翻页,可导出 CSV/JSONL)。遇到需要登录的网站:先 browser_open 打开登录页,告知用户请在浏览器窗口中完成登录,再调用 browser_wait_for_login 等待(可给 successSelector/successUrl);配置 userDataDir 时登录态会持久化。用户可通过界面右下角面板的实时画面查看浏览器。"
	});
	if (sectionDispose !== void 0) ctx.effect(() => sectionDispose);
	registerBrowserApi(ctx, config, base);
	const webServer = ctx.get("webServer");
	if (webServer !== void 0) {
		applyEmbed(ctx, webServer, base);
		const disposeConfig = webServer.register({
			kind: "exact",
			path: "/__dsh-browser-view__/config",
			handler: (_req, res) => {
				sendJson(res, 200, { basePath: base });
			}
		});
		ctx.effect(() => () => {
			try {
				disposeConfig();
			} catch {}
		});
	}
	const sweepTimer = setInterval(() => {
		try {
			sweepScreenshotDir({
				maxAgeDays: config.screenshotMaxAgeDays,
				maxCount: config.screenshotMaxCount
			});
		} catch {}
	}, 36e5);
	sweepTimer.unref?.();
	ctx.effect(() => () => {
		clearInterval(sweepTimer);
		closeBrowser().catch(() => {});
	});
}
//#endregion
export { apply, inject, name };
