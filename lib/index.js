import { dirname, isAbsolute, join, resolve } from "node:path";
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
//#region lib/types/browser/session/cache.js
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
/** 取页面当前完整 ref 表(browser_find 增量续号合并用;无则空 Map)。 */
function pageRefsOf(page) {
	return refRegistry.get(page) ?? /* @__PURE__ */ new Map();
}
const snapshotCaches = /* @__PURE__ */ new WeakMap();
function snapshotCacheOf(page) {
	return snapshotCaches.get(page);
}
function setSnapshotCache(page, cache) {
	snapshotCaches.set(page, cache);
}
/** 环形容量钳制(1..20,非法值回落默认 5)。导出供测试。 */
function snapshotCapacity(k) {
	const n = Math.floor(Number(k));
	if (!Number.isFinite(n)) return 5;
	return Math.min(Math.max(n, 1), 20);
}
/**
* 追加一个新版本并淘汰超限的最旧版本(纯逻辑,导出供测试)。
* cache 为 undefined 时从 version 1 开始;返回新缓存(不修改入参)。
*/
function pushSnapshotVersion(cache, content, capacity) {
	const version = (cache?.version ?? 0) + 1;
	const k = snapshotCapacity(capacity);
	const history = [...cache?.history ?? [], {
		version,
		text: content.text,
		aria: content.aria
	}];
	if (history.length > k) history.splice(0, history.length - k);
	return {
		version,
		history
	};
}
/** 按版本号取历史条目;不在环形窗口内(更旧/未知)返回 undefined。 */
function snapshotVersionEntry(cache, version) {
	if (cache === void 0) return void 0;
	return cache.history[cache.history.length - 1]?.version === version ? cache.history[cache.history.length - 1] : cache.history.find((e) => e.version === version);
}
//#endregion
//#region lib/types/browser/session/collaboration.js
/**
* 当前人工接管等待状态(browser_pause_for_human 等待期间非空),
* 供实时画面面板展示「等待人工操作」提示。
*/
let pauseState = null;
function setPauseInstruction(instruction) {
	pauseState = {
		instruction,
		startedAt: Date.now()
	};
}
function clearPauseInstruction() {
	pauseState = null;
}
function currentPause() {
	return pauseState;
}
let pendingConfirm = null;
function setPendingConfirm(entry) {
	pendingConfirm = entry;
}
function getPendingConfirm() {
	return pendingConfirm;
}
function clearPendingConfirm() {
	pendingConfirm = null;
}
/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
function resolveConfirm(id, decision) {
	if (pendingConfirm === null || pendingConfirm.id !== id) return false;
	pendingConfirm.decision = decision;
	return true;
}
let toolInFlight = 0;
/** live 工具调用开始(register 包装层调用)。 */
function noteToolStart() {
	toolInFlight++;
}
/** live 工具调用结束(成功/失败都算结束)。 */
function noteToolEnd() {
	if (toolInFlight > 0) toolInFlight--;
}
/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
function activeToolCalls() {
	return toolInFlight;
}
//#endregion
//#region lib/types/browser/walker.js
/** 页内 walker 核心(自包含;勿引用模块级变量、勿导入任何模块)。 */
function __walkerCore() {
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
		const wrapLabel = el.closest("label");
		if (wrapLabel) {
			const t = wrapLabel.textContent?.trim();
			if (t) return t.slice(0, 60);
		}
		if ([
			"checkbox",
			"radio",
			"switch"
		].includes(role)) {
			const container = el.closest("label, [class*='wrapper'], [class*='item'], li");
			if (container) {
				const t = container.textContent?.trim();
				if (t) return t.replace(/\s+/g, " ").slice(0, 60);
			}
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
	/** 纯只读几何判定: 元素是否在当前视口可见区域内(含可选边距扩展)。 */
	function isElementInViewport(el, padding = 0) {
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return false;
		const winHeight = window.innerHeight || document.documentElement.clientHeight;
		const winWidth = window.innerWidth || document.documentElement.clientWidth;
		return rect.bottom >= -padding && rect.right >= -padding && rect.top <= winHeight + padding && rect.left <= winWidth + padding;
	}
	/**
	* 统一元素描述结构(F5 顺带统一):aria 快照 ref、find 匹配、
	* 拾取指纹(pick hint)、录制回声(recorder payload)共用同一份字段语义。
	*/
	function describeElement(el) {
		const role = roleOf(el);
		const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "";
		return {
			role,
			name: nameOf(el, role),
			selector: cssPath(el),
			testid,
			id: el.id ?? "",
			tag: el.tagName.toLowerCase(),
			text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
			visible: isVisible(el)
		};
	}
	return {
		INTERACTIVE,
		STRUCTURAL,
		SKIP_TAGS,
		roleOf,
		nameOf,
		cssPath,
		isVisible,
		isElementInViewport,
		describeElement
	};
}
/** walker 核心的序列化源码(模块加载期取一次;tsdown/vitest 均原样保留)。 */
const CORE_SRC = __walkerCore.toString();
/**
* 把消费方 entry(自包含函数,签名 (payload, w: WalkerApi) => R)拼装成
* 可被 page.evaluate 序列化的独立函数 (payload: P) => R。
* 拼装发生在模块加载期(new Function 一次性),调用期零开销。
*/
function injectWalker(entry) {
	const src = `"use strict"; return function (payload) { var __name = (t, v) => t; const w = (${CORE_SRC})(); return (${entry.toString()})(payload, w); };`;
	return new Function(src)();
}
//#endregion
//#region lib/types/browser/session/recorder.js
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
/** window 上的回传 binding 名(须为合法 JS 标识符)。 */
const HUMAN_BINDING = "__dshBrowserHumanEvent";
/** 最近一次 agent DOM 操作(点击/输入/选择)的时间戳;用于区分人手与工具回声。 */
let lastAgentActionAt = 0;
/** agent 即将/刚刚执行了 DOM 操作(register 包装层调用);1.5s 内的页内事件视为工具回声。 */
function noteAgentAction() {
	lastAgentActionAt = Date.now();
}
/** 导出供测试:距上次 agent 操作是否在去重窗口内。 */
function agentActionRecent(now = Date.now(), windowMs = 1500) {
	return now - lastAgentActionAt < windowMs;
}
/**
* 页内人工操作事件 → 录制步骤(纯函数,导出供测试)。
* payload 由 installHumanRecorder 生成:{ kind, selector, value?, testid?, role?, name?, id?, text?, tag? }。
* 无法映射(缺 selector / 未知 kind / 空输入)返回 null。
*/
function humanEventToStep(payload) {
	if (payload === null || typeof payload !== "object") return null;
	const p = payload;
	const selector = typeof p.selector === "string" ? p.selector : "";
	if (!selector) return null;
	const hint = {
		...p.testid !== void 0 && p.testid !== "" ? { testid: String(p.testid) } : {},
		...p.role !== void 0 && p.role !== "" ? { role: String(p.role) } : {},
		...p.name !== void 0 && p.name !== "" ? { name: String(p.name) } : {},
		...p.id !== void 0 && p.id !== "" ? { id: String(p.id) } : {},
		...p.text !== void 0 && p.text !== "" ? { text: String(p.text) } : {},
		...p.tag !== void 0 && p.tag !== "" ? { tag: String(p.tag) } : {}
	};
	if (p.kind === "click") return {
		tool: "browser_click",
		args: { selector },
		meta: {
			hint,
			source: "human"
		}
	};
	if (p.kind === "input") {
		const text = typeof p.value === "string" ? p.value : "";
		if (text === "") return null;
		return {
			tool: "browser_type",
			args: {
				selector,
				text
			},
			meta: {
				hint,
				source: "human"
			}
		};
	}
	if (p.kind === "select") {
		const option = typeof p.value === "string" ? p.value.trim() : "";
		if (!option) return null;
		return {
			tool: "browser_select",
			args: {
				selector,
				option
			},
			meta: {
				hint,
				source: "human"
			}
		};
	}
	return null;
}
/** binding 回调入站口:仅录制中生效;去重窗口内(agent 工具回声)丢弃。 */
function handleHumanEvent(payload) {
	if (!isRecording()) return;
	if (agentActionRecent()) return;
	const step = humanEventToStep(payload);
	if (step === null) return;
	recordCall({
		tool: step.tool,
		args: step.args,
		ok: true,
		ms: 0,
		ts: Date.now(),
		meta: step.meta,
		source: "human"
	});
}
/**
* 页内注入的人工操作监听(addInitScript 序列化;每次导航自动重装)。
* 监听常驻但 node 侧只在录制中生效,关闭录制等价于"移除"。
* 只上报可交互元素上的 click 与表单控件的 change,避免逐键噪音。
* F5 收敛:cssPath 等元素描述来自 walker.ts 单一来源(构建期拼装注入),
* 不再持有内联副本;payload 字段语义与 v0.3 完全一致。
*/
const installHumanRecorder = injectWalker((_payload, w) => {
	const cssPath = w.cssPath;
	const w2 = window;
	if (w2.__dshHumanRecorder === true) return;
	w2.__dshHumanRecorder = true;
	const BINDING = "__dshBrowserHumanEvent";
	const INTERACTIVE = "a,button,input,select,textarea,summary,[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='switch'],[role='checkbox']";
	function payloadOf(el, kind, value) {
		const aria = el.getAttribute("aria-label");
		return {
			kind,
			selector: cssPath(el),
			...value !== void 0 ? { value } : {},
			testid: el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "",
			role: el.getAttribute("role") ?? "",
			name: aria && aria.trim() ? aria.trim().slice(0, 40) : "",
			id: el.id ?? "",
			text: (el.innerText || el.textContent || "").trim().slice(0, 40),
			tag: el.tagName.toLowerCase()
		};
	}
	function send(payload) {
		try {
			const fn = w2[BINDING];
			if (typeof fn === "function") Promise.resolve(fn(payload)).catch(() => {});
		} catch {}
	}
	document.addEventListener("click", (e) => {
		const target = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
		if (target === null) return;
		send(payloadOf(target, "click"));
	}, true);
	document.addEventListener("change", (e) => {
		const t = e.target instanceof Element ? e.target : null;
		if (t === null) return;
		if (t.tagName === "SELECT") {
			const opt = t.selectedOptions[0];
			send(payloadOf(t, "select", (opt ? opt.textContent : "").trim()));
		} else if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
			const type = (t.getAttribute("type") ?? "text").toLowerCase();
			if (type === "checkbox" || type === "radio") return;
			if (type === "file") return;
			send(payloadOf(t, "input", t.value));
		}
	}, true);
});
//#endregion
//#region lib/types/browser/session/screenshot.js
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
//#region lib/types/browser/adapters/quiescence.js
/**
* 等待页面 DOM 达到稳定状态
* @param page Playwright Page 实例
* @param options 等待选项
* @returns boolean 成功达到稳态返回 true，超时返回 false
*/
async function waitForDOMQuiescence(page, options = {}) {
	const quietMs = Math.min(Math.max(options.quietMs ?? 80, 20), 1e3);
	const maxTimeoutMs = Math.min(Math.max(options.maxTimeoutMs ?? 2500, 200), 15e3);
	const scope = options.scope ?? "";
	try {
		const isQuiet = await page.evaluate(`(({ quietMs, maxTimeoutMs, scope }) => {
        return new Promise((resolve) => {
          const root = scope ? document.querySelector(scope) : document.body;
          if (!root) return resolve(true);

          let timer = null;
          let settled = false;

          const finish = (result) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (maxTimer) clearTimeout(maxTimer);
            observer.disconnect();
            resolve(result);
          };

          const resetTimer = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => finish(true), quietMs);
          };

          const observer = new MutationObserver(() => {
            resetTimer();
          });

          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          // 初始启动计时器：若页面本身已静止，quietMs 后直接放行
          resetTimer();

          // 最大兜底超时
          const maxTimer = setTimeout(() => finish(false), maxTimeoutMs);
        });
      })`, {
			quietMs,
			maxTimeoutMs,
			scope
		});
		return Boolean(isQuiet);
	} catch {
		return false;
	}
}
//#endregion
//#region lib/types/browser/adapters/antd.js
var AntDesignAdapter = class {
	name = "ant-design";
	/** 活动弹窗/抽屉选择器 */
	activeDialogSelector = ".ant-modal:not([style*='display: none']), .ant-drawer:not([style*='display: none'])";
	/** 探测当前页面是否使用了 Ant Design 体系 */
	async matches(page) {
		try {
			return await page.evaluate(() => {
				return Boolean(document.querySelector("[class*='ant-'], #__ANTD_PRO__"));
			});
		} catch {
			return false;
		}
	}
	/** 语义抽取钩子 (注意：函数将在页内自包含执行，不得引用外部闭包) */
	extractionHook = {
		resolveName(el, role) {
			if ([
				"checkbox",
				"radio",
				"switch"
			].includes(role)) {
				const wrap = el.closest("label, .ant-radio-wrapper, .ant-checkbox-wrapper, .ant-transfer-list-content-item, [class*='wrapper']");
				if (wrap) {
					const t = (wrap.textContent || "").trim().replace(/\s+/g, " ");
					if (t) return t.slice(0, 60);
				}
			}
			const formItem = el.closest(".ant-form-item");
			if (formItem) {
				const labelEl = formItem.querySelector(".ant-form-item-label, label");
				if (labelEl && (typeof labelEl.contains !== "function" || !labelEl.contains(el))) {
					const txt = (labelEl.textContent || "").trim().replace(/\s+/g, " ");
					if (txt) return txt.slice(0, 60);
				}
			}
			if (role === "dialog") {
				const titleEl = el.querySelector(".ant-modal-title, .ant-drawer-title");
				if (titleEl) {
					const txt = (titleEl.textContent || "").trim().replace(/\s+/g, " ");
					if (txt) return txt.slice(0, 60);
				}
			}
			return null;
		},
		resolveRole(el) {
			const cls = el.className;
			if (typeof cls === "string") {
				if (cls.includes("ant-tabs-tab-btn") || cls.includes("ant-tabs-tab")) return "tab";
				if (cls.includes("ant-btn")) return "button";
				if (cls.includes("ant-select-item-option")) return "option";
				if (cls.includes("ant-table-row")) return "row";
			}
			return null;
		},
		checkVisible(el) {
			if ("checkVisibility" in el) {
				if (!el.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true
				})) return false;
			}
			const cls = el.className;
			if (typeof cls === "string") {
				if (cls.includes("-hidden") || cls.includes("ant-modal-wrap-hidden") || cls.includes("ant-select-dropdown-hidden")) return false;
			}
			return null;
		}
	};
	/** 交互动作拦截器 (主机侧执行) */
	actionInterceptor = {
		async beforeAction(ctx) {
			if (ctx.action !== "click") return;
			try {
				if (await ctx.target.evaluate((el) => {
					if (el.tagName.toLowerCase() !== "input") return false;
					const type = (el.getAttribute("type") || "").toLowerCase();
					if (type !== "checkbox" && type !== "radio") return false;
					const rect = el.getBoundingClientRect();
					const wrapper = el.closest(".ant-checkbox-wrapper, .ant-radio-wrapper");
					return Boolean(wrapper && (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).opacity === "0"));
				})) return ctx.target.locator("xpath=ancestor::*[contains(@class, '-wrapper')][1]");
			} catch {}
		},
		async onActionError(ctx, error) {
			const msg = error.message;
			if (msg.includes("intercepts pointer events")) {
				if (msg.includes("ant-modal-wrap") || msg.includes("ant-modal-mask") || msg.includes("ant-drawer-mask")) {
					await ctx.page.waitForTimeout(100);
					return {
						handled: true,
						retryWith: {
							force: true,
							timeoutMs: 3e3
						}
					};
				}
			}
			return { handled: false };
		}
	};
	/** 页面稳态等待 */
	async waitForQuiescence(page, options) {
		return waitForDOMQuiescence(page, {
			quietMs: 80,
			maxTimeoutMs: 2e3,
			...options
		});
	}
	/** 判断是否匹配 Ant Design 下拉触发器 */
	async matchesSelect(ctx) {
		return ctx.target.evaluate((el) => {
			if (el.closest(".ant-select, .ant-select-selector")) return true;
			const id = el.id || "";
			const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
			return /^rc_select_/.test(id) || /^rc_select_/.test(controls);
		}).catch(() => false);
	}
	/** 执行 Ant Design 下拉选择 */
	async selectOption(ctx) {
		const { target, page, want, exact, timeout, label } = ctx;
		const probe = Math.min(timeout, 5e3);
		if (!await target.evaluate((el) => {
			if (el.getAttribute("aria-expanded") === "true") return true;
			const host = el.closest(".ant-select");
			if (host && host.classList.contains("ant-select-open")) return true;
			if (host?.getAttribute("aria-expanded") === "true") return true;
			if ((host?.querySelector("input[role=\"combobox\"], [aria-expanded]"))?.getAttribute("aria-expanded") === "true") return true;
			const controlsId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
			if (controlsId) {
				const dd = document.getElementById(controlsId);
				if (dd && dd.offsetParent !== null) return true;
			}
			return false;
		}).catch(() => false)) {
			const clickTarget = target.locator(".ant-select-selector").first();
			if (await clickTarget.count().catch(() => 0) > 0) await clickTarget.click({ timeout: 2e3 }).catch(async () => {
				await target.click({
					timeout: 2e3,
					force: true
				});
			});
			else await target.click({ timeout: 2e3 }).catch(async () => {
				await target.click({
					timeout: 2e3,
					force: true
				});
			});
			await page.waitForTimeout(120);
		}
		const controlsId = await target.evaluate((el) => el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "").catch(() => "");
		let options = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([style*='display: none']) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden):not([style*='display: none']) [role='option']:not([style*='height: 0px'])");
		if (controlsId) {
			const parentDropdown = page.locator(`xpath=//*[@id='${controlsId}']/ancestor-or-self::*[contains(@class, 'ant-select-dropdown')][1]`);
			const visual = parentDropdown.locator(".ant-select-item-option");
			if (await visual.count().catch(() => 0) > 0) options = visual;
			else {
				const roleOpt = parentDropdown.locator("[role='option']:not([style*='height: 0px'])");
				if (await roleOpt.count().catch(() => 0) > 0) options = roleOpt;
			}
		}
		await options.first().waitFor({
			state: "visible",
			timeout: Math.min(timeout, 5e3)
		}).catch(() => {});
		const entries = await options.evaluateAll((els) => els.map((el) => {
			return {
				text: (el.innerText || el.textContent || "").trim(),
				title: el.getAttribute("title") || "",
				aria: el.getAttribute("aria-label") || ""
			};
		})).catch(() => []);
		const visibleTexts = entries.map((e) => e.text || e.title || e.aria).filter(Boolean);
		if (visibleTexts.length === 0) throw new Error(`点击 ${label} 后未出现 Ant Design 下拉选项`);
		const index = entries.findIndex((e) => {
			const candidates = [
				e.text,
				e.title,
				e.aria
			].filter(Boolean);
			return exact ? candidates.some((c) => c === want) : candidates.some((c) => c.includes(want));
		});
		if (index === -1) {
			await target.click({ timeout: 1e3 }).catch(() => {});
			throw new Error(`下拉选项中无 "${want}";可见选项: ${visibleTexts.join(" / ")}`);
		}
		const chosen = options.nth(index);
		try {
			await chosen.click({ timeout: Math.min(probe, 2e3) });
		} catch {
			try {
				await chosen.click({
					timeout: 1500,
					force: true
				});
			} catch {
				await chosen.evaluate((el) => {
					el.scrollIntoView?.({ block: "nearest" });
					el.click();
				});
			}
		}
		return { selected: visibleTexts[index] };
	}
	/** Ant Design 表单项精准识别与填充 */
	async fillFormField(page, field, scope) {
		const root = scope ? page.locator(scope) : page;
		const { key, value } = field;
		try {
			const formItems = root.locator(".ant-form-item");
			const count = await formItems.count().catch(() => 0);
			for (let i = 0; i < count; i++) {
				const item = formItems.nth(i);
				const labelEl = item.locator("label, .ant-form-item-label").first();
				let labelText = await labelEl.innerText().catch(() => "") || await labelEl.textContent().catch(() => "") || "";
				labelText = labelText.trim();
				if (labelText.includes(key)) {
					const antSelect = item.locator(".ant-select").first();
					if (await antSelect.count().catch(() => 0) > 0) {
						await this.selectOption({
							page,
							target: antSelect,
							label: key,
							want: String(value),
							exact: false,
							timeout: 5e3
						});
						return { handled: true };
					}
					const antSwitch = item.locator(".ant-switch").first();
					if (await antSwitch.count().catch(() => 0) > 0) {
						const isChecked = await antSwitch.evaluate((el) => el.getAttribute("aria-checked") === "true").catch(() => false);
						if (Boolean(value) !== isChecked) await antSwitch.click();
						return { handled: true };
					}
					const input = item.locator("input, textarea").first();
					if (await input.count().catch(() => 0) > 0) {
						await input.fill(String(value));
						return { handled: true };
					}
				}
			}
		} catch (err) {
			return {
				handled: false,
				error: err.message
			};
		}
		return { handled: false };
	}
};
//#endregion
//#region lib/types/browser/tools/common.js
/** 组件库下拉框的可见选项选择器并集(antd / element-plus / 通用 ARIA listbox)。 */
const DROPDOWN_OPTION_SELECTOR = [
	".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
	".el-select-dropdown__item",
	"[role='listbox'] [role='option']"
].join(", ");
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
/** 最长公共子串长度(小写比较;零依赖,导出供测试)。 */
function lcsScore(a, b) {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	if (x === "" || y === "") return 0;
	let best = 0;
	const prev = new Array(y.length + 1).fill(0);
	for (let i = 1; i <= x.length; i++) {
		let diag = 0;
		for (let j = 1; j <= y.length; j++) {
			const tmp = prev[j];
			prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
			if (prev[j] > best) best = prev[j];
			diag = tmp;
		}
	}
	return best;
}
/** 零命中时按相似度挑 top5 候选(导出供测试)。 */
function topSuggestions(query, candidates, count = 5) {
	const min = query.trim().length <= 3 ? 1 : 2;
	return candidates.map((c) => ({
		...c,
		score: lcsScore(query, c.name)
	})).filter((c) => c.score >= min).sort((a, b) => b.score - a.score).slice(0, count).map(({ role, name, score }) => ({
		role,
		name,
		score
	}));
}
/**
* 行级 diff:掐掉公共前缀/后缀,返回变化区。导出供测试。
* 全等返回 { unchanged: true };否则 changedFrom 为新文本中变化区首行(1 起)。
*/
function diffLines(oldText, newText) {
	const a = oldText === "" ? [] : oldText.split("\n");
	const b = newText === "" ? [] : newText.split("\n");
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
	if (i === a.length && i === b.length) return { unchanged: true };
	let j = 0;
	while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j += 1;
	return {
		unchanged: false,
		changedFrom: i + 1,
		lines: b.slice(i, b.length - j),
		removed: a.length - i - j
	};
}
/** 给本身无超时的 Playwright 调用(evaluate/allTextContents)加有界保护,防页面主线程忙时无限挂起。 */
async function withTimeout(p, ms, what) {
	let timer;
	const guard = new Promise((_, reject) => {
		timer = setTimeout(() => reject(/* @__PURE__ */ new Error(`${what} 超时(${ms}ms;页面主线程可能正忙)`)), ms);
	});
	try {
		return await Promise.race([p, guard]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
/**
* 防御性解码 eval 脚本:模型/人工偶发把脚本 JSON.stringify 一次再传
* (脚本以 \" 开头、换行变字面 \\n),回放/录制链路不纠错会导致语法错误。
* 识别条件:字符串以引号包裹且含反斜杠转义,且 JSON.parse 结果仍是字符串。
* 无法解析或语义不变场景原样返回(裸字符串字面量如 "hello" 不含转义,不受影响)。
*/
function unwrapDoubleEncodedScript(script) {
	if (script.length >= 2 && script.startsWith("\"") && script.endsWith("\"") && script.includes("\\")) try {
		const parsed = JSON.parse(script);
		if (typeof parsed === "string" && parsed !== script) return {
			script: parsed,
			unwrapped: true
		};
	} catch {}
	return {
		script,
		unwrapped: false
	};
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
//#endregion
//#region lib/types/browser/adapters/element.js
var ElementPlusAdapter = class {
	name = "element-plus";
	/** 活动弹窗/抽屉选择器 */
	activeDialogSelector = ".el-dialog:not([style*='display: none']), .el-drawer:not([style*='display: none'])";
	/** 探测当前页面是否使用了 Element Plus 体系 */
	async matches(page) {
		try {
			return await page.evaluate(() => {
				return Boolean(document.querySelector("[class*='el-']"));
			});
		} catch {
			return false;
		}
	}
	/** 语义抽取钩子 */
	extractionHook = {
		resolveName(el, role) {
			if ([
				"checkbox",
				"radio",
				"switch"
			].includes(role)) {
				const wrap = el.closest(".el-radio, .el-checkbox, .el-switch, label");
				if (wrap) {
					const t = (wrap.textContent || "").trim().replace(/\s+/g, " ");
					if (t) return t.slice(0, 60);
				}
			}
			const formItem = el.closest(".el-form-item");
			if (formItem) {
				const labelEl = formItem.querySelector(".el-form-item__label, label");
				if (labelEl && (typeof labelEl.contains !== "function" || !labelEl.contains(el))) {
					const txt = (labelEl.textContent || "").trim().replace(/\s+/g, " ");
					if (txt) return txt.slice(0, 60);
				}
			}
			return null;
		},
		resolveRole(el) {
			const cls = el.className;
			if (typeof cls === "string") {
				if (cls.includes("el-tabs__item")) return "tab";
				if (cls.includes("el-button")) return "button";
				if (cls.includes("el-select-dropdown__item")) return "option";
			}
			return null;
		},
		checkVisible(el) {
			if ("checkVisibility" in el) {
				if (!el.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true
				})) return false;
			}
			const cls = el.className;
			if (typeof cls === "string" && cls.includes("is-hidden")) return false;
			return null;
		}
	};
	/** 判断是否匹配 Element Plus 下拉触发器 */
	async matchesSelect(ctx) {
		return ctx.target.evaluate((el) => !!el.closest(".el-select, .el-select__wrapper")).catch(() => false);
	}
	/** 执行 Element Plus 下拉选择 */
	async selectOption(ctx) {
		const { target, page, want, exact, timeout, label } = ctx;
		const probe = Math.min(timeout, 5e3);
		if (!await target.evaluate((el) => {
			return el.closest(".el-select")?.classList.contains("is-focus") || el.getAttribute("aria-expanded") === "true";
		}).catch(() => false)) await target.click({ timeout: Math.min(timeout, 1e4) }).catch(async () => {
			await target.click({
				timeout: 2e3,
				force: true
			});
		});
		const options = page.locator(".el-select-dropdown:not([style*='display: none']) .el-select-dropdown__item");
		await options.first().waitFor({
			state: "visible",
			timeout: Math.min(timeout, 5e3)
		}).catch(() => {});
		const texts = (await withTimeout(options.allTextContents(), probe, "读取 Element 下拉选项").catch(() => [])).map((t) => t.trim()).filter(Boolean);
		if (texts.length === 0) throw new Error(`点击 ${label} 后未出现 Element 下拉选项`);
		const index = texts.findIndex((t) => exact ? t === want : t.includes(want));
		if (index === -1) {
			await target.click({ timeout: 1e3 }).catch(() => {});
			throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
		}
		const chosen = options.nth(index);
		try {
			await chosen.click({ timeout: Math.min(probe, 2e3) });
		} catch {
			await chosen.click({
				timeout: 1500,
				force: true
			});
		}
		return { selected: texts[index] };
	}
	async waitForQuiescence(page, options) {
		return waitForDOMQuiescence(page, {
			quietMs: 80,
			maxTimeoutMs: 2e3,
			...options
		});
	}
};
//#endregion
//#region lib/types/browser/adapters/generic.js
var GenericAdapter = class {
	name = "generic";
	/** 通用 W3C 标准弹窗选择器 */
	activeDialogSelector = "[role='dialog']:not([style*='display: none']), dialog[open]";
	async matches(_page) {
		return true;
	}
	extractionHook = {
		resolveName(el, _role) {
			const wrapLabel = el.closest("label");
			if (wrapLabel) {
				const t = (wrapLabel.textContent || "").trim().replace(/\s+/g, " ");
				if (t) return t.slice(0, 60);
			}
			return null;
		},
		checkVisible(el) {
			if ("checkVisibility" in el) {
				if (!el.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true
				})) return false;
			}
			return null;
		}
	};
	/** 兜底匹配所有下拉交互 */
	async matchesSelect(_ctx) {
		return true;
	}
	/** 执行下拉选择：支持原生 <select> 与通用 ARIA combobox/listbox */
	async selectOption(ctx) {
		const { target, page, want, exact, timeout, label } = ctx;
		const probe = Math.min(timeout, 5e3);
		if (await withTimeout(target.evaluate((el) => el.tagName.toLowerCase()), 2e3, "检查原生 select 标签").catch(() => "") === "select") try {
			await target.selectOption({ label: want }, { timeout });
			return { selected: want };
		} catch {
			const options = await withTimeout(target.locator("option").allTextContents(), probe, "读取原生下拉选项").catch(() => []);
			throw new Error(`原生下拉无选项 "${want}";可用选项: ${options.map((t) => t.trim()).join(" / ")}`);
		}
		if (!await target.evaluate((el) => el.getAttribute("aria-expanded") === "true" || el.closest("[role=\"combobox\"]")?.getAttribute("aria-expanded") === "true").catch(() => false)) await target.click({ timeout: Math.min(timeout, 1e4) }).catch(async () => {
			await target.click({
				timeout: 2e3,
				force: true
			});
		});
		const options = page.locator("[role='listbox']:not([hidden]):not([style*='display: none']):not([style*='height: 0px']) [role='option']:not([style*='height: 0px'])");
		await options.first().waitFor({
			state: "visible",
			timeout: Math.min(timeout, 5e3)
		}).catch(() => {});
		const texts = (await withTimeout(options.allTextContents(), probe, "读取通用下拉选项").catch(() => [])).map((t) => t.trim()).filter(Boolean);
		if (texts.length === 0) throw new Error(`点击 ${label} 后未出现下拉选项(非原生 select,也不是已知的组件库下拉)`);
		const index = texts.findIndex((t) => exact ? t === want : t.includes(want));
		if (index === -1) {
			await target.click({ timeout: 1e3 }).catch(() => {});
			throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
		}
		const chosen = options.nth(index);
		try {
			await chosen.click({ timeout: Math.min(probe, 2e3) });
		} catch {
			try {
				await chosen.click({
					timeout: 1500,
					force: true
				});
			} catch {
				await chosen.evaluate((el) => el.click());
			}
		}
		return { selected: texts[index] };
	}
	async waitForQuiescence(page, options) {
		return waitForDOMQuiescence(page, options);
	}
	async fillFormField(page, field, scope) {
		const root = scope ? page.locator(scope) : page;
		const { key, value } = field;
		try {
			const loc = root.locator(key).first();
			if (await loc.count() > 0) {
				const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
				const type = await loc.getAttribute("type").catch(() => "");
				if (tag === "select") {
					await loc.selectOption({ label: String(value) });
					return { handled: true };
				}
				if (type === "checkbox") {
					const checked = await loc.isChecked();
					if (Boolean(value) !== checked) await loc.click();
					return { handled: true };
				}
				await loc.fill(String(value));
				return { handled: true };
			}
		} catch {}
		try {
			const byLabel = root.getByLabel(key, { exact: false }).first();
			if (await byLabel.count() > 0) {
				if (await byLabel.evaluate((el) => el.tagName.toLowerCase()).catch(() => "") === "select") await byLabel.selectOption({ label: String(value) });
				else await byLabel.fill(String(value));
				return { handled: true };
			}
			const byPlaceholder = root.getByPlaceholder(key, { exact: false }).first();
			if (await byPlaceholder.count() > 0) {
				await byPlaceholder.fill(String(value));
				return { handled: true };
			}
		} catch (e) {
			return {
				handled: false,
				error: e.message
			};
		}
		return { handled: false };
	}
};
//#endregion
//#region lib/types/browser/adapters/registry.js
var UIAdapterRegistryImpl = class {
	adapters = /* @__PURE__ */ new Map();
	pageAdapterCache = /* @__PURE__ */ new WeakMap();
	constructor() {
		this.register(new GenericAdapter());
		this.register(new AntDesignAdapter());
		this.register(new ElementPlusAdapter());
	}
	/** 注册新的 UI 适配器插件 */
	register(adapter) {
		this.adapters.set(adapter.name, adapter);
	}
	/** 获取指定适配器 */
	get(name) {
		return this.adapters.get(name);
	}
	/**
	* 自动探测并获取当前页面对应的适配器
	* 结果绑定到 Page 弱引用缓存中，避免重复探测
	*/
	async getActiveAdapter(page) {
		const cached = this.pageAdapterCache.get(page);
		if (cached) return cached;
		for (const [name, adapter] of this.adapters.entries()) {
			if (name === "generic") continue;
			try {
				if (await adapter.matches(page)) {
					this.pageAdapterCache.set(page, adapter);
					return adapter;
				}
			} catch {}
		}
		const fallback = this.adapters.get("generic");
		this.pageAdapterCache.set(page, fallback);
		return fallback;
	}
	/**
	* 聚合所有已注册适配器的活动弹窗/对话框选择器
	*/
	getActiveDialogSelectors() {
		const selectors = [];
		for (const adapter of this.adapters.values()) if (adapter.activeDialogSelector) selectors.push(adapter.activeDialogSelector);
		return selectors.join(", ");
	}
	/**
	* 调度器入口: 自动根据目标节点特征解析最合适的 UI 适配器执行下拉交互
	*/
	async executeSelect(ctx) {
		const active = await this.getActiveAdapter(ctx.page);
		if (active.name !== "generic" && active.matchesSelect && await active.matchesSelect(ctx)) {
			if (active.selectOption) return await active.selectOption(ctx);
		}
		for (const [name, adapter] of this.adapters.entries()) {
			if (name === "generic" || name === active.name) continue;
			if (adapter.matchesSelect && await adapter.matchesSelect(ctx)) {
				if (adapter.selectOption) return await adapter.selectOption(ctx);
			}
		}
		const generic = this.adapters.get("generic");
		if (generic?.selectOption) return await generic.selectOption(ctx);
		throw new Error(`未找到匹配的下拉适配器: ${ctx.label}`);
	}
	/**
	* 清理页面的适配器缓存 (通常在页面发生整页导航时调用)
	*/
	clearCache(page) {
		this.pageAdapterCache.delete(page);
	}
	/**
	* 动作预处理管道 (执行目标提升等)
	*/
	async beforeAction(ctx) {
		const adapter = await this.getActiveAdapter(ctx.page);
		if (adapter.actionInterceptor?.beforeAction) return adapter.actionInterceptor.beforeAction(ctx);
	}
	/**
	* 动作异常自愈管道 (处理遮罩层、阻挡重试等)
	*/
	async onActionError(ctx, error) {
		const adapter = await this.getActiveAdapter(ctx.page);
		if (adapter.actionInterceptor?.onActionError) return adapter.actionInterceptor.onActionError(ctx, error);
	}
	/**
	* 表单项智能填充调度：
	* 优先尝试当前匹配的 UI 框架特异性适配器，若未处理则交由通用适配器兜底
	*/
	async fillFormField(page, field, scope) {
		const active = await this.getActiveAdapter(page);
		if (active.fillFormField) {
			const res = await active.fillFormField(page, field, scope);
			if (res.handled) return res;
		}
		const generic = this.adapters.get("generic");
		if (generic?.fillFormField) return await generic.fillFormField(page, field, scope);
		return {
			handled: false,
			error: "未找到能处理该字段的适配器"
		};
	}
};
const adapterRegistry = new UIAdapterRegistryImpl();
//#endregion
//#region lib/types/browser/adapters/dom.js
/**
* 提取表单元素关联的语义 Label:
* 覆盖原生 label、aria-labelledby、以及各类主流组件库(Ant Design, Element Plus, Bootstrap 等)的表单包装结构。
* 供 targetLocator 及无障碍名称校验在浏览器端(evaluate)执行。
*/
function extractElementLabel(el) {
	if ("labels" in el && el.labels?.length) {
		const joined = Array.from(el.labels || []).map((l) => (l.innerText || l.textContent || "").trim()).filter(Boolean).join(" ");
		if (joined) return joined;
	}
	const labelledBy = el.getAttribute("aria-labelledby");
	if (labelledBy) {
		const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter((n) => !!n).map((n) => (n.innerText || n.textContent || "").trim()).filter(Boolean).join(" ");
		if (text) return text;
	}
	const formItem = el.closest(".ant-form-item, .el-form-item, [role='group'], form, .form-group");
	if (formItem) {
		const labelEl = formItem.querySelector(".ant-form-item-label, .el-form-item__label, label");
		if (labelEl) {
			const txt = (labelEl.innerText || labelEl.textContent || "").trim();
			if (txt) return txt;
		}
	}
	return "";
}
/** 主流前端组件库激活弹窗/对话框的选择器列表 (从注册表动态聚合，兜底默认值) */
const ACTIVE_DIALOG_SELECTORS = [
	"[role='dialog']:not([style*='display: none'])",
	".ant-modal:not([style*='display: none'])",
	".el-dialog:not([style*='display: none'])",
	"dialog[open]"
].join(", ");
/**
* 获取当前页面上处于活动状态的弹窗容器(Locator)。
* 优先从 adapterRegistry 动态聚合选择器，兼顾测试 Mock 对象。
*/
function getActiveDialog(page) {
	const selector = adapterRegistry.getActiveDialogSelectors() || ACTIVE_DIALOG_SELECTORS;
	const dialogLoc = page.locator(selector);
	return typeof dialogLoc.last === "function" ? dialogLoc.last() : dialogLoc.first();
}
//#endregion
//#region lib/types/browser/session/target.js
/**
* 统一解析目标元素：
* 自动识别 selector 或 ref；若 ref 标记位于子 Frame，自动绑定到对应子 Frame 上下文。
* 具备路径防漂移校验与 getByRole 自愈降级能力。
*/
async function resolveTargetLocator(page, args) {
	if (args.ref !== void 0 && args.ref !== "") {
		const ref = String(args.ref);
		const entry = pageRef(page, ref);
		if (entry === void 0) throw new Error(`未知 ref: ${ref}(页面导航或重新快照后旧 ref 失效;请先 browser_snapshot { mode: "aria" })`);
		let container = page;
		let isIFrame = false;
		if (typeof entry.frameIndex === "number" && entry.frameIndex > 0) {
			const targetFrame = page.frames()[entry.frameIndex];
			if (!targetFrame) throw new Error(`引用元素所在的子 Frame (index=${entry.frameIndex}) 已失效或销毁`);
			container = targetFrame;
			isIFrame = true;
		}
		const byPath = container.locator(entry.selector).first();
		if (await withTimeout(byPath.count(), 3e3, "解析 ref 路径").catch(() => 0) > 0) {
			if (await withTimeout(byPath.evaluate((el, { role, name, labelScript }) => {
				const tag = el.tagName.toLowerCase();
				const type = (el.getAttribute("type") ?? "").toLowerCase();
				const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
				const roleOk = role === "" || roleAttr === role || role === "link" && tag === "a" || role === "button" && (tag === "button" || tag === "summary" || tag === "input" && [
					"button",
					"submit",
					"reset",
					"image"
				].includes(type)) || ["textbox", "searchbox"].includes(role) && (tag === "textarea" || tag === "input" && ![
					"hidden",
					"checkbox",
					"radio"
				].includes(type)) || role === "combobox" && tag === "select" || role === "checkbox" && tag === "input" && type === "checkbox" || role === "radio" && tag === "input" && type === "radio";
				const aria = el.getAttribute("aria-label") ?? "";
				const ph = el.getAttribute("placeholder") ?? "";
				const title = el.getAttribute("title") ?? "";
				const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
				let labelText = "";
				try {
					const labelFn = new Function("el", `return (${labelScript})(el);`);
					labelText = String(labelFn(el) || "");
				} catch {}
				const nameOk = name === "" || aria.includes(name) || ph.includes(name) || title.includes(name) || text.includes(name) || labelText.includes(name);
				return roleOk && nameOk;
			}, {
				role: entry.role,
				name: entry.name,
				labelScript: extractElementLabel.toString()
			}), 3e3, "校验 ref 元素").catch(() => false)) return {
				locator: byPath,
				container,
				entry,
				isIFrame
			};
		}
		if (!isIFrame) try {
			const activeDialog = getActiveDialog(page);
			if (activeDialog && typeof activeDialog.getByRole === "function") {
				const inDialog = entry.name !== "" ? activeDialog.getByRole(entry.role, { name: entry.name }).first() : activeDialog.getByRole(entry.role).first();
				if (await withTimeout(inDialog.count(), 1e3, "弹窗内 role 查找").catch(() => 0) > 0) return {
					locator: inDialog,
					container,
					entry,
					isIFrame: false
				};
			}
		} catch {}
		const byRole = entry.name !== "" ? container.getByRole(entry.role, { name: entry.name }).first() : container.getByRole(entry.role).first();
		if (await withTimeout(byRole.count(), 3e3, "解析 ref role 降级").catch(() => 0) > 0) return {
			locator: byRole,
			container,
			entry,
			isIFrame
		};
		throw new Error(`ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`);
	}
	if (args.selector === void 0) throw new Error("需要 selector 或 ref 之一");
	return {
		locator: page.locator(String(args.selector)).first(),
		container: page,
		isIFrame: false
	};
}
/** 兼容旧版签名的目标定位快捷方式 */
async function targetLocator(page, args) {
	return (await resolveTargetLocator(page, args)).locator;
}
//#endregion
//#region lib/types/browser/adapters/select.js
/**
* 调度器入口: 自动委托给 adapterRegistry 解析最合适的 UI 适配器执行交互。
*/
async function executeSelectAdapter(ctx) {
	return adapterRegistry.executeSelect(ctx);
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
	page.addInitScript("window.__name = (t, v) => t; globalThis.__name = (t, v) => t;").catch(() => {});
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
		adapterRegistry.clearCache(page);
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
	page.exposeBinding(HUMAN_BINDING, (_source, payload) => {
		handleHumanEvent(payload);
		return null;
	}).then(() => page.addInitScript(installHumanRecorder)).then(() => page.evaluate(installHumanRecorder).catch(() => {})).catch(() => {});
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
const namedContexts = /* @__PURE__ */ new Map();
function namedContextsOf() {
	return namedContexts;
}
/** 把一个已 attach 的页面注册进 profile 标签表并激活,返回分配的 tab id。 */
function registerTabPage(state, page) {
	const id = state.counter++;
	state.pages.set(id, page);
	state.activeId = id;
	return id;
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
	namedContexts.clear();
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
/** Best-effort current page identity, safe when nothing is open.title 有界防页面忙时挂起。 */
async function pageIdentity(page) {
	try {
		const title = await new Promise((resolve, reject) => {
			const t = setTimeout(() => reject(/* @__PURE__ */ new Error("title timeout")), 2e3);
			page.title().then(resolve, reject).finally(() => clearTimeout(t));
		}).catch(() => "");
		return {
			url: page.url(),
			title
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
//#endregion
//#region lib/types/browser/tools/navigation.js
async function openTool(configOrArgs, maybeArgs) {
	const isSingleArg = maybeArgs === void 0;
	const config = isSingleArg && typeof configOrArgs?.url === "string" ? {} : configOrArgs;
	const args = isSingleArg ? configOrArgs : maybeArgs;
	const page = await getPage(config ?? {});
	await page.goto(String(args.url), {
		waitUntil: args.waitUntil ?? "domcontentloaded",
		timeout: args.timeoutMs ?? config?.timeoutMs
	});
	return {
		url: page.url(),
		title: await page.title(),
		status: "ok"
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
/**
* 命名隔离上下文:同一浏览器进程内独立 cookies/storage 的"标签组"。
* 页注册进 profile 标签表(所有既有工具直接可用),context 只做归属记录:
* list / new(name?, url?) / switch(激活该组的一页,没有则新开) / close(整组关闭)。
* 持久模式(userDataDir)浏览器只有单一 context,不支持本工具(用 profiles 替代)。
*/
async function contextTool(config, args) {
	const action = args.action ?? "list";
	const state = stateOf();
	const contexts = namedContextsOf();
	if (action === "list") return {
		contexts: Array.from(contexts.entries()).map(([name, c]) => {
			return {
				name,
				pages: Array.from(c.pageIds).filter((id) => state.pages.has(id)).length,
				active: state.activeId !== null && c.pageIds.has(state.activeId),
				createdAt: c.createdAt
			};
		}),
		profile: currentProfile
	};
	if (action === "new") {
		const name = String(args.name ?? "").trim() || `ctx-${contexts.size + 1}`;
		if (contexts.has(name)) throw new Error(`context "${name}" 已存在;如需重建先 browser_context { action: "close", name }`);
		if (state.browser === null && state.context === null) await launchProfile(currentProfile, config);
		if (state.browser === null) throw new Error("持久模式(userDataDir)的浏览器只有单一 context,不支持多 context;需要多账号隔离请配置 profiles 多套 userDataDir");
		const context = await state.browser.newContext();
		const page = await context.newPage();
		attachPage(page, profileConfig(config, currentProfile));
		const id = registerTabPage(state, page);
		const entry = {
			context,
			pageIds: /* @__PURE__ */ new Set([id]),
			createdAt: Date.now()
		};
		contexts.set(name, entry);
		page.on("close", () => {
			entry.pageIds.delete(id);
		});
		let navigated;
		if (typeof args.url === "string" && args.url) {
			await page.goto(args.url, { waitUntil: "domcontentloaded" });
			navigated = page.url();
		}
		return {
			created: name,
			...navigated !== void 0 ? { navigated } : {},
			...await pageIdentity(page)
		};
	}
	if (action === "switch") {
		const name = String(args.name ?? "").trim();
		if (!name) throw new Error("switch 需要 name(用 list 查看已有 context)");
		const entry = contexts.get(name);
		if (entry === void 0) throw new Error(`context "${name}" 不存在;已有: ${Array.from(contexts.keys()).join("、") || "(无)"}`);
		for (const id of entry.pageIds) {
			const page = state.pages.get(id);
			if (page !== void 0) {
				state.activeId = id;
				return {
					switched: name,
					...await pageIdentity(page)
				};
			}
		}
		const page = await entry.context.newPage();
		attachPage(page, profileConfig(config, currentProfile));
		const id = registerTabPage(state, page);
		entry.pageIds.add(id);
		page.on("close", () => {
			entry.pageIds.delete(id);
		});
		return {
			switched: name,
			pages: 1,
			...await pageIdentity(page)
		};
	}
	if (action === "close") {
		const name = String(args.name ?? "").trim();
		if (!name) throw new Error("close 需要 name");
		const entry = contexts.get(name);
		if (entry === void 0) throw new Error(`context "${name}" 不存在`);
		for (const id of entry.pageIds) {
			state.pages.delete(id);
			if (state.activeId === id) state.activeId = Array.from(state.pages.keys()).pop() ?? null;
		}
		entry.pageIds.clear();
		contexts.delete(name);
		try {
			await entry.context.close();
		} catch {}
		return {
			closed: name,
			remainingTabs: state.pages.size
		};
	}
	throw new Error(`未知 action: ${action}(list | new | switch | close)`);
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
async function closeTool() {
	await closeBrowser();
	return { closed: true };
}
//#endregion
//#region lib/types/browser/tools/interaction.js
async function clickTool(config, args) {
	const page = await getPage(config);
	let target = await targetLocator(page, args);
	const label = String(args.ref ?? args.selector ?? "");
	const lifted = await adapterRegistry.beforeAction({
		page,
		config,
		target,
		action: "click",
		args
	});
	if (lifted) target = lifted;
	try {
		await target.click({
			timeout: args.timeoutMs ?? config.timeoutMs,
			force: args.force === true
		});
	} catch (e) {
		const recovered = await adapterRegistry.onActionError({
			page,
			config,
			target,
			action: "click",
			args
		}, e);
		if (recovered?.handled && recovered.retryWith) await (recovered.retryWith.target ?? target).click({
			timeout: recovered.retryWith.timeoutMs ?? 3e3,
			force: recovered.retryWith.force ?? false
		});
		else {
			const msg = e instanceof Error ? e.message : String(e);
			let diag = "";
			try {
				if (await target.count() === 0) diag = "元素未匹配(selector 可能写错或元素未渲染)";
				else diag = await target.first().isVisible() ? "元素可见但不可交互(被遮挡/禁用?);若页面刚发生跳转,点击可能实际已生效" : "元素存在但不可见";
			} catch {
				diag = "元素已从页面移除(若页面刚发生跳转,点击可能实际已生效)";
			}
			throw new Error(`click 失败: ${label} — ${diag};原始错误: ${msg}`);
		}
	}
	const adapter = await adapterRegistry.getActiveAdapter(page);
	await Promise.race([page.waitForLoadState("domcontentloaded").catch(() => {}), adapter.waitForQuiescence ? adapter.waitForQuiescence(page, { quietMs: 60 }) : Promise.resolve()]);
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
		try {
			await target.click({ timeout: Math.min(args.timeoutMs ?? config.timeoutMs, 5e3) });
		} catch {
			await target.click({
				timeout: 2e3,
				force: true
			}).catch(() => {});
		}
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
/**
* 下拉选择原语:委托给 UI 组件库下拉适配器(Native / AntDesign / ElementPlus / GenericARIA)。
* 各组件库特异性的展开机制、虚拟列表穿透与 0 宽度读屏傀儡节点过滤完全隔离在适配器中。
*/
async function selectTool(config, args) {
	const page = await getPage(config);
	const target = await targetLocator(page, args);
	const label = String(args.ref ?? args.selector);
	const want = String(args.option ?? "");
	if (!want) throw new Error("select 需要 option(选项文本)");
	return {
		selected: (await executeSelectAdapter({
			page,
			target,
			label,
			want,
			exact: args.exact === true,
			timeout: args.timeoutMs ?? config.timeoutMs
		})).selected,
		selector: label,
		...await pageIdentity(page)
	};
}
async function evalTool(config, args) {
	const page = await getPage(config);
	const { script, unwrapped } = unwrapDoubleEncodedScript(String(args.script ?? ""));
	const wrapped = /[\n;]|^\s*return\b/.test(script) ? `(async () => {\n${script}\n})()` : `(${script})`;
	const raw = await page.evaluate(wrapped);
	let result;
	try {
		result = JSON.parse(JSON.stringify(raw ?? null));
	} catch {
		result = raw === void 0 ? null : String(raw);
	}
	return {
		result,
		...unwrapped ? { scriptUnwrapped: true } : {}
	};
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
/**
* 智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层
*/
async function formFillTool(config, args) {
	const fields = args.fields;
	if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) throw new Error("缺少 fields 参数: 需提供包含表单键值对的对象");
	const page = await getPage(config);
	const scope = typeof args.scope === "string" && args.scope ? args.scope : void 0;
	const filled = [];
	const skipped = [];
	const errors = {};
	for (const [key, value] of Object.entries(fields)) try {
		const res = await adapterRegistry.fillFormField(page, {
			key,
			value
		}, scope);
		if (res.handled) {
			filled.push(key);
			await waitForDOMQuiescence(page, {
				quietMs: 60,
				maxTimeoutMs: 1500
			}).catch(() => {});
		} else {
			skipped.push(key);
			if (res.error) errors[key] = res.error;
		}
	} catch (e) {
		skipped.push(key);
		errors[key] = e.message || String(e);
	}
	let submitted = void 0;
	if (args.submitButton) try {
		const submitTarget = typeof args.submitButton === "string" ? args.submitButton : "提交";
		let btnLocator;
		try {
			const resolved = await resolveTargetLocator(page, { selector: submitTarget });
			if (await resolved.locator.count() > 0) btnLocator = resolved.locator;
			else btnLocator = page.getByRole("button", { name: submitTarget }).first();
		} catch {
			btnLocator = page.getByRole("button", { name: submitTarget }).first();
		}
		await btnLocator.click({ timeout: args.timeoutMs ?? 5e3 });
		submitted = true;
		await waitForDOMQuiescence(page, {
			quietMs: 80,
			maxTimeoutMs: 2e3
		}).catch(() => {});
	} catch (e) {
		submitted = false;
		errors["__submit__"] = `提交按钮点击失败: ${e.message}`;
	}
	return {
		filled,
		skipped,
		errors,
		...submitted !== void 0 ? { submitted } : {}
	};
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
/**
* 磁盘热重载:录制文件被外部编辑(手修 JSON)后,同会话内 browser_replay 仍用内存旧缓存。
* 比较文件 mtime 与内存 savedAt(留 2s 余量容忍写入延迟),更新过则重新加载进内存表。
* 返回是否发生了重载;文件不存在或损坏时静默保留内存版。
*/
function reloadRecordingIfChanged(name) {
	const mem = savedRecordings.get(name);
	const file = join(recordingsDir(), `${safeName(name)}.json`);
	let mtime;
	try {
		mtime = statSync(file).mtimeMs;
	} catch {
		return false;
	}
	if (mem !== void 0 && mtime <= mem.savedAt + 2e3) return false;
	try {
		const data = JSON.parse(readFileSync(file, "utf8"));
		if (data !== null && typeof data === "object" && Array.isArray(data.steps)) {
			savedRecordings.set(name, {
				steps: data.steps,
				savedAt: mtime
			});
			return true;
		}
	} catch {}
	return false;
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
//#region lib/types/browser/tools/inspection.js
/**
* 页内 ARIA 树构建(walker 单一来源:roleOf/nameOf/cssPath/isVisible 与
* INTERACTIVE/STRUCTURAL 集合来自 walker.ts,构建期拼装注入)。
* 遍历 DOM:结构角色(navigation/main/form/table/heading…)直接打印;
* 可交互元素分配 ref=e1..eN 并附稳定 CSS 路径;无语义容器(div/span)穿透。
* 输出形如 `- button "登录" [ref=e3]` 的缩进树,供纯文本模型定位操作目标。
*/
const buildAriaTree = injectWalker((payload, w) => {
	const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible, isElementInViewport } = w;
	const lines = [];
	const refs = [];
	let truncated = false;
	let prunedCount = 0;
	const padding = payload.viewportPadding ?? 0;
	function walk(el, depth) {
		if (truncated) return;
		if (lines.length >= 400 || depth > 10) {
			truncated = true;
			return;
		}
		if (payload.viewportOnly && !isElementInViewport(el, padding)) {
			prunedCount += 1;
			return;
		}
		const role = roleOf(el);
		if (INTERACTIVE.has(role)) {
			if (!isVisible(el)) return;
			const name = nameOf(el, role);
			const ref = refs.length < payload.maxRefs ? `e${refs.length + 1}` : "";
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
	if (document.body === null) return {
		tree: "",
		refs,
		truncated: false,
		scopeMissing: false,
		prunedCount: 0
	};
	const root = payload.scope ? document.querySelector(payload.scope) : document.body;
	if (root === null) return {
		tree: "",
		refs,
		truncated: false,
		scopeMissing: true,
		prunedCount: 0
	};
	walk(root, 0);
	return {
		tree: lines.join("\n"),
		refs,
		truncated,
		scopeMissing: false,
		prunedCount
	};
});
/**
* 页内语义查找:只收集匹配 query 的可交互元素(不构建全量树)。
* role/name/cssPath/isVisible 与 buildAriaTree 同一来源(walker.ts 单一来源,
* 构建期拼装注入),语义天然一致,不再需要手工同步副本。
*/
const findInteractive = injectWalker((payload, w) => {
	const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible } = w;
	/** 最近的结构化祖先(区域上下文,帮助区分多命中)。 */
	function ancestorsOf(el) {
		const out = [];
		let cur = el.parentElement;
		while (cur && cur !== document.body && out.length < 3) {
			const role = roleOf(cur);
			if (STRUCTURAL.has(role)) {
				const name = nameOf(cur, role);
				out.push(name !== "" ? `${role} "${name.replace(/"/g, "'")}"` : role);
			}
			cur = cur.parentElement;
		}
		return out;
	}
	const q = payload.query.trim().toLowerCase();
	const matches = [];
	const candidates = [];
	let scanned = 0;
	const root = payload.scope ? document.querySelector(payload.scope) : document.body;
	if (root === null) return {
		matches: [],
		candidates,
		scanned: 0
	};
	const stack = [root];
	while (stack.length > 0) {
		const el = stack.pop();
		const role = roleOf(el);
		if (INTERACTIVE.has(role)) {
			if (!isVisible(el)) continue;
			const name = nameOf(el, role);
			const idOrTestid = el.id || el.getAttribute("data-testid") || "";
			let hit = false;
			if (name !== "") {
				const n = name.toLowerCase();
				hit = payload.exact ? n === q : n.includes(q);
			}
			if (!hit && idOrTestid !== "" && idOrTestid.toLowerCase() === q) hit = true;
			scanned += 1;
			if (name !== "" && candidates.length < 50) candidates.push({
				role,
				name
			});
			if (hit && matches.length < payload.limit) matches.push({
				role,
				name,
				selector: cssPath(el),
				ancestors: ancestorsOf(el)
			});
			continue;
		}
		for (const c of Array.from(el.children)) if (!SKIP_TAGS.has(c.tagName.toLowerCase())) stack.push(c);
	}
	return {
		matches,
		candidates,
		scanned
	};
});
/**
* 为命中元素增量分配 ref:沿用既有注册表的编号继续(不与上次快照冲突),
* 合并写回;返回带 ref 的命中列表(上限 maxRefs,超出标 truncated)。
* 导出供测试(纯逻辑,不依赖浏览器)。
*/
function assignRefs(existing, matches, maxRefs) {
	let next = 0;
	for (const key of existing.keys()) {
		const n = Number(key.replace(/^e/, ""));
		if (Number.isFinite(n) && n > next) next = n;
	}
	const merged = new Map(existing);
	const withRefs = [];
	let truncated = false;
	for (const m of matches) {
		if (merged.size >= maxRefs) {
			truncated = true;
			break;
		}
		next += 1;
		const ref = `e${next}`;
		merged.set(ref, {
			role: m.role,
			name: m.name,
			selector: m.selector
		});
		withRefs.push({
			ref,
			...m
		});
	}
	return {
		withRefs,
		merged,
		truncated
	};
}
/**
* 语义元素定位:按名称(或 id/data-testid)在可交互元素中查找,只返回命中的
* ref + 区域上下文,不输出全量 aria 树 —— 大页面定位单个目标时 token 开销
* 远小于 browser_snapshot { mode: "aria" }。返回的 ref 可直接用于
* click/type/select/press。零命中不抛错,附最相近候选供二次定位。
*/
async function findTool(config, args) {
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) throw new Error("缺少 query: 要找的元素名称(如「提交」「登录」,或 id/data-testid)");
	const page = await getPage(config);
	const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
	const data = await page.evaluate(findInteractive, {
		query,
		exact: args.exact === true,
		scope: typeof args.scope === "string" && args.scope ? args.scope : "",
		limit: 20
	});
	const { withRefs, merged, truncated } = assignRefs(pageRefsOf(page), data.matches, maxRefs);
	setPageRefs(page, merged);
	const suggestions = withRefs.length === 0 ? topSuggestions(query, data.candidates) : [];
	return {
		found: withRefs.length,
		matches: withRefs.slice(0, 10).map(({ ref, role, name, ancestors }) => ({
			ref,
			role,
			name,
			ancestors
		})),
		...suggestions.length > 0 ? { suggestions } : {},
		...truncated ? { truncated } : {},
		scanned: data.scanned,
		url: page.url(),
		title: await page.title()
	};
}
async function snapshotTool(config, args) {
	const page = await getPage(config);
	const maxText = args.maxTextChars ?? config.maxTextChars;
	const scope = typeof args.scope === "string" && args.scope ? args.scope : "";
	const since = args.since !== void 0 ? Number(args.since) : void 0;
	const ariaMode = args.mode === "aria";
	const viewportOnly = args.viewportOnly === true;
	const viewportPadding = Number(args.viewportPadding ?? 0) || 0;
	const identity = {
		url: page.url(),
		title: await page.title()
	};
	const cache = snapshotCacheOf(page);
	const capacity = config.snapshotHistory ?? 5;
	const base = since !== void 0 ? snapshotVersionEntry(cache, since) : void 0;
	const canDiff = base !== void 0;
	let content;
	let extra = {};
	let walkerTruncated = false;
	if (ariaMode) {
		const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
		const data = await page.mainFrame().evaluate(buildAriaTree, {
			maxRefs,
			scope,
			viewportOnly,
			viewportPadding
		});
		if (data.scopeMissing) throw new Error(`scope 未命中: 页面中没有匹配 "${scope}" 的元素`);
		const map = new Map(data.refs.map((r) => [r.ref, {
			role: r.role,
			name: r.name,
			selector: r.selector,
			frameIndex: 0,
			frameUrl: page.url()
		}]));
		let finalTree = data.tree;
		let prunedTotal = data.prunedCount;
		if (!scope) {
			const frames = page.frames();
			for (let fIdx = 1; fIdx < frames.length; fIdx++) {
				const sub = frames[fIdx];
				if (sub.isDetached()) continue;
				try {
					const subData = await withTimeout(sub.evaluate(buildAriaTree, {
						maxRefs: 50,
						scope: "",
						viewportOnly,
						viewportPadding
					}), 2e3, "子 Frame 遍历");
					if (subData && subData.tree && subData.tree.trim()) {
						const frameTitle = sub.name() || sub.url() || `frame-${fIdx}`;
						const subTreeAdjusted = subData.tree.replace(/\[ref=(e\d+)\]/g, `[ref=f${fIdx}:$1]`);
						finalTree += `\n--- [frame: ${frameTitle}] ---\n${subTreeAdjusted}\n------------------------------`;
						prunedTotal += subData.prunedCount;
						for (const r of subData.refs) map.set(`f${fIdx}:${r.ref}`, {
							role: r.role,
							name: r.name,
							selector: r.selector,
							frameIndex: fIdx,
							frameUrl: sub.url()
						});
					}
				} catch {}
			}
		}
		setPageRefs(page, map);
		content = finalTree;
		walkerTruncated = data.truncated;
		extra = {
			refs: map.size,
			...viewportOnly ? {
				viewportOnly: true,
				prunedCount: prunedTotal
			} : {}
		};
	} else {
		const maxLinks = args.maxLinks ?? config.maxLinks;
		const data = await page.evaluate((payload) => {
			const root = payload.sc ? document.querySelector(payload.sc) : document.body;
			const text = root instanceof HTMLElement ? root.innerText : "";
			const scopeEl = root ?? document;
			return {
				text,
				links: Array.from(scopeEl.querySelectorAll("a")).slice(0, payload.maxL).map((a) => ({
					text: (a.innerText || a.textContent || "").trim().slice(0, 200),
					href: a.href
				})),
				inputs: scopeEl.querySelectorAll("input, textarea, select").length,
				scopeMissing: payload.sc !== "" && root === null
			};
		}, {
			maxL: maxLinks,
			sc: scope
		});
		if (data.scopeMissing) throw new Error(`scope 未命中: 页面中没有匹配 "${scope}" 的元素`);
		content = compressText(data.text);
		extra = {
			links: data.links,
			inputs: data.inputs
		};
	}
	const key = ariaMode ? "aria" : "text";
	if (canDiff && base[key] === content) return {
		unchanged: true,
		contentVersion: cache.version,
		...scope !== "" ? { scope } : {},
		...identity,
		...extra
	};
	if (canDiff) {
		const d = diffLines(base[key], content);
		const latest = cache.history[cache.history.length - 1];
		const next = pushSnapshotVersion(cache, {
			text: ariaMode ? latest.text : content,
			aria: ariaMode ? content : latest.aria
		}, capacity);
		setSnapshotCache(page, next);
		if (d.unchanged) return {
			unchanged: true,
			contentVersion: next.version,
			...scope !== "" ? { scope } : {},
			...identity,
			...extra
		};
		return {
			diff: true,
			contentVersion: next.version,
			changedFrom: d.changedFrom,
			removed: d.removed,
			...scope !== "" ? { scope } : {},
			[ariaMode ? "tree" : "text"]: (d.lines ?? []).join("\n").slice(0, maxText),
			truncated: false,
			...identity,
			...extra
		};
	}
	const latestEntry = cache?.history[cache.history.length - 1];
	const next = pushSnapshotVersion(cache, {
		text: ariaMode ? latestEntry?.text ?? "" : content,
		aria: ariaMode ? content : latestEntry?.aria ?? ""
	}, capacity);
	setSnapshotCache(page, next);
	return {
		contentVersion: next.version,
		...since !== void 0 ? { stale: true } : {},
		...scope !== "" ? { scope } : {},
		[ariaMode ? "tree" : "text"]: content.slice(0, maxText),
		truncated: ariaMode ? walkerTruncated || content.length > maxText : content.length > maxText,
		...identity,
		...extra
	};
}
const removeSomOverlay = () => {
	document.getElementById("__dsh_som_overlay__")?.remove();
};
const injectSomOverlay = injectWalker((payload, w) => {
	const { INTERACTIVE, roleOf, nameOf, isVisible, isElementInViewport } = w;
	const marks = [];
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.id = "__dsh_som_overlay__";
	svg.setAttribute("style", "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;");
	const candidates = [];
	function collect(el) {
		const role = roleOf(el);
		if (INTERACTIVE.has(role) && isVisible(el) && isElementInViewport(el, 0)) {
			candidates.push(el);
			return;
		}
		for (const c of Array.from(el.children)) if (c.tagName !== "SCRIPT" && c.tagName !== "STYLE") collect(c);
	}
	if (document.body) collect(document.body);
	const badgeColor = payload.color === "blue" ? "#1890ff" : payload.color === "green" ? "#52c41a" : "#ff4d4f";
	let count = 0;
	for (const el of candidates) {
		if (count >= payload.maxMarks) break;
		const rect = el.getBoundingClientRect();
		if (rect.width < 8 || rect.height < 8) continue;
		count += 1;
		const role = roleOf(el);
		const name = nameOf(el, role);
		const x = Math.max(0, rect.left);
		const y = Math.max(0, rect.top);
		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		const rectEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
		rectEl.setAttribute("x", String(x));
		rectEl.setAttribute("y", String(y));
		rectEl.setAttribute("width", count >= 10 ? "24" : "18");
		rectEl.setAttribute("height", "18");
		rectEl.setAttribute("rx", "3");
		rectEl.setAttribute("fill", badgeColor);
		rectEl.setAttribute("opacity", "0.92");
		const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
		textEl.setAttribute("x", String(x + (count >= 10 ? 12 : 9)));
		textEl.setAttribute("y", String(y + 13));
		textEl.setAttribute("fill", "#ffffff");
		textEl.setAttribute("font-size", "11");
		textEl.setAttribute("font-weight", "bold");
		textEl.setAttribute("text-anchor", "middle");
		textEl.setAttribute("font-family", "sans-serif");
		textEl.textContent = String(count);
		g.appendChild(rectEl);
		g.appendChild(textEl);
		svg.appendChild(g);
		marks.push({
			id: count,
			role,
			name
		});
	}
	document.documentElement.appendChild(svg);
	return marks;
});
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
	let somMarks = void 0;
	if (args.som === true) try {
		somMarks = await page.evaluate(injectSomOverlay, {
			maxMarks: Number(args.maxMarks ?? 50) || 50,
			color: String(args.somColor ?? "red")
		});
	} catch {}
	let buffer;
	try {
		buffer = await page.screenshot({ type: "png" });
	} finally {
		if (args.som === true) await Promise.resolve(page.evaluate(removeSomOverlay)).catch(() => {});
	}
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
		height: viewport.height,
		...somMarks ? {
			som: true,
			somMarks
		} : {}
	};
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
//#endregion
//#region lib/types/browser/tools/testing.js
async function waitTool(config, args) {
	const page = await getPage(config);
	const ms = Math.max(0, Math.min(Number(args.ms ?? 1e3) || 0, 6e4));
	await page.waitForTimeout(ms);
	return {
		waitedMs: ms,
		...await pageIdentity(page)
	};
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
/** 网络记录查询:list / failed / wait / clear。兼容 (args) 与 (config, args) 两种调用签名。 */
async function networkTool(configOrArgs, maybeArgs) {
	const args = (maybeArgs !== void 0 ? maybeArgs : configOrArgs) ?? {};
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
//#endregion
//#region lib/types/browser/tools/doctor.js
/** 面板自检探针(由 index.ts 在注册 API 后注入;fetch 本机 /status)。 */
let doctorProbe = null;
function setDoctorProbe(fn) {
	doctorProbe = fn;
}
/** 目录可写性检查(mkdir + 写探针文件 + 删除)。导出供测试。 */
function checkWritableDir(dir) {
	try {
		mkdirSync(dir, { recursive: true });
		const probe = join(dir, `.doctor-probe-${Date.now()}`);
		writeFileSync(probe, "ok");
		unlinkSync(probe);
		return {
			ok: true,
			detail: dir
		};
	} catch (e) {
		return {
			ok: false,
			detail: `${dir} — ${e instanceof Error ? e.message : String(e)}`
		};
	}
}
/** 可执行文件存在性检查(executablePath 显式配置用)。导出供测试。 */
function checkExecutable(path) {
	if (!existsSync(path)) return {
		name: "executable",
		ok: false,
		detail: `executablePath 指向的文件不存在: ${path}`,
		advice: "修正 cordis.patch.yml 的 browser.executablePath,或清空该字段改用 channel 自动探测"
	};
	try {
		accessSync(path, constants.X_OK);
	} catch {
		return {
			name: "executable",
			ok: false,
			detail: `文件存在但不可执行: ${path}`,
			advice: "chmod +x 或确认路径指向浏览器主程序"
		};
	}
	const st = statSync(path);
	return {
		name: "executable",
		ok: st.isFile(),
		detail: st.isFile() ? path : `不是普通文件: ${path}`,
		...st.isFile() ? {} : { advice: "确认路径指向浏览器可执行文件而非目录" }
	};
}
/** 一次性健康诊断:不启动浏览器,只做静态/本地检查。 */
async function doctorTool(config, _args, exec) {
	const checks = [];
	if (config.executablePath) checks.push(checkExecutable(config.executablePath));
	else {
		const channel = config.channel ?? "auto";
		checks.push({
			name: "channel",
			ok: true,
			detail: channel === "auto" || channel === "" ? "auto:按平台序探测已装浏览器(chrome → msedge → chromium;Windows 为 msedge 优先),启动失败会提示安装" : `channel = ${channel}(由 Playwright 在首次启动时解析)`
		});
		try {
			const bundled = (await loadPlaywright()).chromium.executablePath();
			checks.push({
				name: "bundled-chromium",
				ok: existsSync(bundled),
				detail: existsSync(bundled) ? bundled : `playwright 捆绑 chromium 未安装(${bundled})`,
				...existsSync(bundled) ? {} : { advice: "可选:npx playwright install chromium 安装兜底浏览器,或依赖系统已装的 Edge/Chrome" }
			});
		} catch {
			checks.push({
				name: "playwright-core",
				ok: false,
				detail: "playwright-core 不可用",
				advice: "在 profile 中安装 playwright-core(dsh plugin --profile web add playwright-core)"
			});
		}
	}
	if (config.userDataDir) {
		const w = checkWritableDir(config.userDataDir);
		checks.push({
			name: "userDataDir",
			ok: w.ok,
			detail: w.ok ? `${config.userDataDir}(登录态将持久化)` : w.detail,
			...!w.ok ? { advice: "确认目录存在且当前用户可写" } : {}
		});
	} else checks.push({
		name: "userDataDir",
		ok: true,
		detail: "未配置(登录态随会话,DSH 重启后失效)"
	});
	const baseDir = workspaceBaseDir(config, exec);
	const baseWritable = checkWritableDir(baseDir);
	checks.push({
		name: "workspaceDir",
		ok: baseWritable.ok,
		detail: baseWritable.ok ? `${baseDir}(来源: ${config.workspaceDir ? "config.workspaceDir" : "会话 cwd 探测"})` : baseWritable.detail,
		...!baseWritable.ok ? { advice: "设置 config.workspaceDir 钉死基准目录,或修正会话工作区权限" } : {}
	});
	for (const [name, dir] of [
		["screenshotDir", config.screenshotDir ?? ".dsh-browser/screenshots"],
		["downloadDir", config.downloadDir ?? ".dsh-browser/downloads"],
		["baselineDir", config.baselineDir ?? ".dsh-browser/baselines"]
	]) {
		const abs = isAbsolute(dir) ? dir : resolve(baseDir, dir);
		const w = checkWritableDir(abs);
		checks.push({
			name,
			ok: w.ok,
			detail: w.ok ? abs : w.detail,
			...!w.ok ? { advice: `检查 ${abs} 的创建/写权限(父目录需可写)` } : {}
		});
	}
	const state = stateOf();
	checks.push({
		name: "session",
		ok: true,
		detail: `当前 profile "${currentProfile}"${state.browser !== null ? " 已启动浏览器" : " 浏览器未启动(首次调用工具时自动启动)"} · ${state.pages.size} 个标签 · 共 ${profileStates.size} 个 profile`
	});
	const basePath = config.basePath ?? "/browser";
	if (doctorProbe !== null) try {
		const r = await doctorProbe(basePath);
		checks.push({
			name: "panel",
			ok: r.ok,
			detail: r.detail,
			...r.advice ? { advice: r.advice } : {}
		});
	} catch (e) {
		checks.push({
			name: "panel",
			ok: false,
			detail: `探针执行失败: ${e instanceof Error ? e.message : String(e)}`,
			advice: `在浏览器打开 http://<DSH地址>${basePath}/status 手动验证`
		});
	}
	else checks.push({
		name: "panel",
		ok: true,
		detail: `本进程无 webServer(工具半),面板 API 基路径 ${basePath}`
	});
	const failed = checks.filter((c) => !c.ok).length;
	return {
		checks,
		summary: {
			ok: failed === 0,
			passed: checks.length - failed,
			failed
		}
	};
}
//#endregion
//#region lib/types/browser/tools/collaboration.js
const sleep$1 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
* 操作预告高亮:agent 即将 click/type/select/press 的元素在页面上琥珀色描边
* ~1.5 秒。异步不阻塞(fire-and-forget,任何失败静默),不影响操作时序。
*/
function previewHighlight(page, selector, label) {
	if (page === null || selector === "") return;
	page.evaluate((arg) => {
		const el = document.querySelector(arg.selector);
		if (el === null) return;
		const rect = el.getBoundingClientRect();
		const box = document.createElement("div");
		box.setAttribute("data-dsh-preview", "");
		Object.assign(box.style, {
			position: "fixed",
			left: `${rect.left - 2}px`,
			top: `${rect.top - 2}px`,
			width: `${rect.width + 4}px`,
			height: `${rect.height + 4}px`,
			border: "2px solid #f59e0b",
			borderRadius: "4px",
			background: "rgba(245, 158, 11, 0.08)",
			pointerEvents: "none",
			zIndex: "2147483646",
			boxSizing: "border-box",
			transition: "opacity 0.3s"
		});
		const tip = document.createElement("div");
		Object.assign(tip.style, {
			position: "absolute",
			left: "0",
			top: "-20px",
			font: "12px/1.4 -apple-system,'PingFang SC',sans-serif",
			color: "#fff",
			background: "#f59e0b",
			padding: "1px 6px",
			borderRadius: "4px",
			whiteSpace: "nowrap"
		});
		tip.textContent = `agent: ${arg.label}`;
		box.appendChild(tip);
		document.documentElement.appendChild(box);
		setTimeout(() => {
			box.style.opacity = "0";
			setTimeout(() => box.remove(), 400);
		}, 1200);
	}, {
		selector,
		label
	}).catch(() => {});
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
/**
* 人工接管等待(通用版 wait_for_login):agent 把控制权交还给用户(验证码 /
* 二次确认 / 人工复核等)。instruction 会显示在实时画面面板;完成条件三选一:
* successSelector(元素出现)/ successUrl(URL 正则)/ 两者都不给则以
* URL 变化或页面内容签名变化视为完成。轮询间隔 2 秒,超时返回 completed:false
* (不抛错)。导出 runPauseOnPage 供测试注入 fake page。
*/
async function runPauseOnPage(page, args) {
	const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
	if (!instruction) throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
	const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 3e5) || 3e5, 1e3), 6e5);
	let startUrl = "";
	try {
		startUrl = page.url();
	} catch {}
	const startedAt = Date.now();
	const pageSignature = async () => {
		try {
			return await page.evaluate(() => {
				const body = document.body;
				return `${location.href}|${body ? body.innerText.length : 0}|${document.querySelectorAll("input,button,a").length}`;
			});
		} catch {
			return page.url();
		}
	};
	const startSig = args.successSelector || args.successUrl ? "" : await pageSignature();
	let completed = false;
	let detail = `等待人工操作超时(${timeoutMs}ms)`;
	setPauseInstruction(instruction);
	try {
		const deadline = startedAt + timeoutMs;
		while (Date.now() < deadline) {
			try {
				if (args.successSelector) completed = await page.locator(String(args.successSelector)).first().isVisible();
				else if (args.successUrl) completed = new RegExp(String(args.successUrl)).test(page.url());
				else completed = page.url() !== startUrl || await pageSignature() !== startSig;
			} catch (e) {
				completed = false;
				detail = `检查完成条件出错: ${e instanceof Error ? e.message : String(e)}`;
			}
			if (completed) {
				detail = "人工操作完成";
				break;
			}
			await page.waitForTimeout(2e3);
		}
	} finally {
		clearPauseInstruction();
	}
	return {
		completed,
		waitedMs: Date.now() - startedAt,
		detail
	};
}
/** 人工接管等待工具入口(缺 instruction 在启动浏览器前即校验,失败更快)。 */
async function pauseForHumanTool(config, args) {
	const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
	if (!instruction) throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
	const page = await getPage(config);
	const result = await runPauseOnPage(page, args);
	return {
		completed: result.completed,
		status: result.completed ? "completed" : "timedOut",
		instruction,
		detail: result.detail,
		waitedMs: result.waitedMs,
		...await pageIdentity(page)
	};
}
/**
* 敏感操作审批:agent 在执行提交/删除/支付类动作前调用,把审批请求推到实时
* 画面面板,挂起等待用户点「允许/拒绝」。超时视为拒绝(fail-closed)。
* 用户允许时返回 { decision: "allowed", ... };拒绝/超时**抛错**(消息含原因),
* 使 live 调用与 replay/batch 步骤统一按失败处理,agent 不应继续敏感动作。
* 决策通过 session.resolveConfirm(面板 POST)写入。
*/
async function confirmTool(config, args) {
	const reason = typeof args.reason === "string" ? args.reason.trim() : "";
	if (!reason) throw new Error("缺少 reason: 请说明要执行什么敏感操作、为什么需要审批(如「提交白名单表单,会产生线上数据变更」)");
	const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? config.confirmTimeoutMs ?? 6e4) || 6e4, 1e3), 6e5);
	const id = `cfm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	setPendingConfirm({
		id,
		reason,
		tool: typeof args.tool === "string" && args.tool ? args.tool : void 0,
		args: args.args && typeof args.args === "object" ? args.args : void 0,
		startedAt: Date.now()
	});
	const startedAt = Date.now();
	let decision = "timeout";
	let detail = `等待审批超时(${timeoutMs}ms),按拒绝处理`;
	try {
		const deadline = startedAt + timeoutMs;
		while (Date.now() < deadline) {
			await sleep$1(500);
			const pending = getPendingConfirm();
			if (pending === null || pending.id !== id) {
				decision = "denied";
				detail = "审批请求已被新的审批取代,按拒绝处理";
				break;
			}
			if (pending.decision !== void 0) {
				decision = pending.decision;
				detail = decision === "allowed" ? "用户允许执行" : "用户拒绝执行";
				break;
			}
		}
	} finally {
		const pending = getPendingConfirm();
		if (pending !== null && pending.id === id) clearPendingConfirm();
	}
	if (decision !== "allowed") throw new Error(`敏感操作被拒绝: ${reason} — ${detail}`);
	return {
		decision,
		id,
		reason,
		waitedMs: Date.now() - startedAt,
		detail
	};
}
/** auto 模式默认敏感文本模式(提交/删除/支付类)。 */
const DEFAULT_SENSITIVE_PATTERNS = [
	"提交",
	"删除",
	"支付"
];
/** auto 模式默认参与判定的工具(已决:只拦 browser_click,type 误报率高)。 */
const DEFAULT_SENSITIVE_TOOLS = ["browser_click"];
/** 敏感判定的页内目标描述提取(walker 统一元素描述,构建期拼装注入)。 */
const describeTarget = injectWalker((sel, w) => {
	const el = document.querySelector(sel);
	return el === null ? null : w.describeElement(el);
});
/**
* 纯逻辑:元素描述命中了哪些敏感模式(role/name/text/id/testid/tag 拼接后
* 子串匹配,大小写不敏感;空白模式忽略)。返回命中的模式列表(空 = 放行)。
* 导出供测试。
*/
function sensitiveHits(desc, patterns) {
	if (desc === null) return [];
	const hay = [
		desc.role,
		desc.name,
		desc.text,
		desc.id,
		desc.testid,
		desc.tag
	].filter((s) => typeof s === "string").join(" ").toLowerCase();
	if (hay === "") return [];
	return patterns.filter((p) => typeof p === "string" && p.trim() !== "" && hay.includes(p.trim().toLowerCase()));
}
/**
* auto 模式审批闸:命中敏感模式时经 confirmTool 弹审批等待用户决策,
* 拒绝/超时抛错(调用方该步失败),允许则返回继续执行原工具。
* 不满足前置条件(非 auto / 工具不在 sensitiveTools / 无模式 / 无活动页 /
* 无目标 selector / 页内取描述失败)一律直接放行,由原工具自行处理错误。
* page 参数仅供测试注入;缺省取当前活动页。
*/
async function confirmGate(config, tool, args, page) {
	if (config.confirmMode !== "auto") return;
	if (tool === "browser_confirm") return;
	if (!(config.sensitiveTools ?? DEFAULT_SENSITIVE_TOOLS).includes(tool)) return;
	const patterns = config.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;
	if (patterns.length === 0) return;
	const active = page !== void 0 ? page : activePage();
	if (active === null || active === void 0) return;
	const sel = typeof args?.selector === "string" && args.selector ? args.selector : typeof args?.ref === "string" && args.ref ? pageRef(active, args.ref)?.selector ?? "" : "";
	if (sel === "") return;
	let desc = null;
	try {
		desc = await active.evaluate(describeTarget, sel);
	} catch {
		return;
	}
	const hits = sensitiveHits(desc, patterns);
	if (hits.length === 0) return;
	const label = desc !== null && (desc.name || desc.text) ? `(${desc.role !== "" ? `${desc.role} ` : ""}"${desc.name || desc.text}")` : "";
	await confirmTool(config, {
		reason: `confirmMode:auto 硬拦截:${tool} 目标元素命中敏感模式 [${hits.join(", ")}] ${label}`.trim(),
		tool,
		args
	});
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
//#region lib/types/browser/tools/extract.js
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
/** suggest 的页内结构探测(injectWalker 注入;walker 提供 cssPath)。 */
const suggestFieldsInPage = injectWalker((payload, w) => {
	const root = payload.scope !== "" ? document.querySelector(payload.scope) : document.body;
	if (root === null) return {
		ok: false,
		reason: `scope 未命中: 页面中没有匹配 "${payload.scope}" 的元素`
	};
	const cellOf = (el) => {
		const a = el.querySelector("a[href]");
		const img = el.querySelector("img[src]");
		return {
			text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
			...a !== null ? { href: a.getAttribute("href") ?? "" } : {},
			...img !== null ? { src: img.getAttribute("src") ?? "" } : {}
		};
	};
	const rows = Array.from(root.querySelectorAll("table tr"));
	if (rows.length >= 2) {
		const first = rows[0];
		let headerTexts = [];
		let record = null;
		if (first.querySelector("th") !== null) {
			headerTexts = Array.from(first.querySelectorAll("th, td")).map((c) => (c.innerText || c.textContent || "").trim());
			record = rows[1] ?? null;
		} else record = first;
		if (record !== null) {
			const cells = Array.from(record.querySelectorAll("td, th")).map(cellOf);
			if (cells.length > 0) return {
				ok: true,
				kind: "table",
				rowSelector: "table tr",
				headerTexts,
				cells
			};
		}
	}
	const list = root.querySelector("ul, ol");
	if (list !== null) {
		const lis = Array.from(list.children).filter((c) => c.tagName === "LI");
		if (lis.length >= 2) {
			const li = lis[0];
			return {
				ok: true,
				kind: "list",
				rowSelector: `${w.cssPath(list)} > li`,
				item: cellOf(li)
			};
		}
	}
	return {
		ok: false,
		reason: "未发现规律结构(无 ≥2 行的表格,也无 ≥2 项的列表);请用 browser_elements/browser_snapshot 查看结构后手写 fields",
		overview: {
			links: root.querySelectorAll("a").length,
			images: root.querySelectorAll("img").length,
			buttons: root.querySelectorAll("button, [role='button']").length,
			headings: root.querySelectorAll("h1, h2, h3, h4").length,
			rows: rows.length,
			textChars: (root.innerText || "").length
		}
	};
});
/** 字段名净化:空白→下划线,限长 30,空回落 col_N。导出供测试。 */
function suggestFieldName(header, index) {
	const h = (header ?? "").trim().replace(/\s+/g, "_");
	return h !== "" ? h.slice(0, 30) : `col_${index + 1}`;
}
/**
* 纯逻辑:由表头与首行单元格特征推断表格 fields(单元格文本/链接 href/图片 src)。
* 返回可直接放进 rows.fields 的嵌套字段数组。导出供测试。
*/
function fieldsFromCells(headerTexts, cells) {
	const out = [];
	cells.forEach((c, i) => {
		const name = suggestFieldName(headerTexts[i], i);
		const sel = `td:nth-of-type(${i + 1})`;
		if (c.src !== void 0) out.push({
			name: `${name}_src`,
			selector: `${sel} img`,
			attr: "src"
		});
		if (c.href !== void 0) out.push({
			name: `${name}_href`,
			selector: `${sel} a`,
			attr: "href"
		});
		out.push({
			name,
			selector: sel
		});
	});
	return out;
}
/**
* 纯逻辑:由首条卡片信息推断列表 fields(项文本/链接/图片)。
* 文本取第一个子元素(项自身无法用 querySelector 自选)。导出供测试。
*/
function fieldsFromCard(item) {
	const out = [];
	if (item.src !== void 0) out.push({
		name: "image",
		selector: "img",
		attr: "src"
	});
	if (item.href !== void 0) out.push({
		name: "link",
		selector: "a",
		attr: "href"
	});
	out.push({
		name: "text",
		selector: ":scope > *:nth-child(1)"
	});
	return out;
}
/** 纯逻辑:由 fields 与单元格样本拼出首行样例(与抽取输出同构;按 td 序号对位)。导出供测试。 */
function sampleOfFields(fields, cells) {
	const out = {};
	for (const f of fields) {
		const m = /td:nth-of-type\((\d+)\)/.exec(f.selector);
		const c = cells[m !== null ? Number(m[1]) - 1 : 0];
		if (f.attr === "href") out[f.name] = c?.href ?? null;
		else if (f.attr === "src") out[f.name] = c?.src ?? null;
		else out[f.name] = c?.text ?? null;
	}
	return out;
}
/**
* suggest 汇总(纯逻辑):由页内分析结果组装「可直接交给抽取模式」的顶层 fields
* (单个 multiple rows 字段 + 行内嵌套字段)与样本。推断失败原样返回。导出供测试。
*/
function suggestWrap(analysis) {
	if (!analysis.ok || analysis.kind === void 0 || analysis.rowSelector === void 0) return {
		suggested: false,
		reason: analysis.reason ?? "结构不足以推断字段",
		...analysis.overview !== void 0 ? { overview: analysis.overview } : {}
	};
	const rowFields = analysis.kind === "table" ? fieldsFromCells(analysis.headerTexts ?? [], analysis.cells ?? []) : fieldsFromCard(analysis.item ?? { text: "" });
	if (rowFields.length === 0) return {
		suggested: false,
		reason: "首条记录内未发现可抽取内容(文本/链接/图片)",
		...analysis.overview !== void 0 ? { overview: analysis.overview } : {}
	};
	const sample = sampleOfFields(rowFields, analysis.kind === "table" ? analysis.cells ?? [] : [analysis.item ?? { text: "" }]);
	return {
		suggested: true,
		kind: analysis.kind,
		rowSelector: analysis.rowSelector,
		...analysis.headerTexts !== void 0 ? { headerTexts: analysis.headerTexts } : {},
		fields: [{
			name: "rows",
			selector: analysis.rowSelector,
			multiple: true,
			fields: rowFields
		}],
		sample
	};
}
async function extractTool(config, args, exec) {
	const page = await getPage(config);
	if (args.action === "suggest") {
		const scope = typeof args.scope === "string" && args.scope !== "" ? args.scope : "";
		return {
			action: "suggest",
			...suggestWrap(await page.evaluate(suggestFieldsInPage, { scope })),
			...await pageIdentity(page)
		};
	}
	const fields = args.fields;
	if (!Array.isArray(fields) || fields.length === 0) throw new Error("extract 需要 fields:[{ name, selector, attr?, multiple?, fields? }] 或 action: \"suggest\" 推断字段");
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
	for (const r of runs) lines.push(`| ${fmtTs(r.ts)} | ${r.source}${r.row !== void 0 ? ` (行${r.row})` : ""}${r.retries !== void 0 ? ` (重试挽回 ${r.retries.recovered}/${r.retries.attempted})` : ""}${r.retryOf !== void 0 ? ` ↻${r.retryOf}` : ""} | ${r.passed}/${r.total} | ${r.failed} | ${r.healedCount} | ${(r.durationMs / 1e3).toFixed(1)}s |`);
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
		return `<tr><td>${esc(fmtTs(r.ts))}</td><td>${esc(r.source)}${r.row !== void 0 ? ` (行${r.row})` : ""}${r.retries !== void 0 ? ` <span class="meta">(重试挽回 ${r.retries.recovered}/${r.retries.attempted})</span>` : ""}${r.retryOf !== void 0 ? ` <span class="meta" title="重跑自 ${esc(r.retryOf)}">↻</span>` : ""}</td><td class="${ok ? "ok" : "bad"}">${r.passed}/${r.total}</td><td>${r.failed}</td><td>${r.healedCount}</td><td>${(r.durationMs / 1e3).toFixed(1)}s</td></tr>`;
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
//#region lib/types/browser/codegen/playwright.js
/**
* 将录制序列转译为符合行业标准规范的原生 Playwright TypeScript 测试代码
*/
function compileToPlaywrightSpec(steps, options = {}) {
	const testTitle = options.title || "E2E Regression Flow";
	const lines = [];
	lines.push(`// 自动编译生成的 Playwright E2E 测试用例`);
	lines.push(`// 来源: dsh-browser 录制回放引擎`);
	lines.push(`import { test, expect } from "@playwright/test";`);
	lines.push(``);
	lines.push(`test.describe(${JSON.stringify(testTitle)}, () => {`);
	lines.push(`  test("执行业务操作与回归断言", async ({ page }) => {`);
	for (const step of steps) {
		const { tool, args = {} } = step;
		switch (tool) {
			case "browser_open": {
				const url = args.url || options.baseUrl || "/";
				lines.push(`    await page.goto(${JSON.stringify(url)});`);
				break;
			}
			case "browser_click": {
				const sel = args.selector || (args.ref ? `[data-ref="${args.ref}"]` : "button");
				lines.push(`    await page.locator(${JSON.stringify(sel)}).click();`);
				break;
			}
			case "browser_type": {
				const sel = args.selector || "input";
				const text = args.text ?? "";
				lines.push(`    await page.locator(${JSON.stringify(sel)}).fill(${JSON.stringify(text)});`);
				break;
			}
			case "browser_press": {
				const sel = args.selector || "body";
				const key = args.key || "Enter";
				lines.push(`    await page.locator(${JSON.stringify(sel)}).press(${JSON.stringify(key)});`);
				break;
			}
			case "browser_select": {
				const sel = args.selector || "select";
				const option = args.option || "";
				lines.push(`    await page.locator(${JSON.stringify(sel)}).selectOption({ label: ${JSON.stringify(option)} });`);
				break;
			}
			case "browser_wait": {
				const ms = Number(args.ms) || 1e3;
				lines.push(`    await page.waitForTimeout(${ms});`);
				break;
			}
			case "browser_wait_for":
				if (args.url) lines.push(`    await page.waitForURL(${JSON.stringify(args.url)});`);
				else if (args.selector) {
					const state = args.state || "visible";
					lines.push(`    await page.locator(${JSON.stringify(args.selector)}).waitFor({ state: ${JSON.stringify(state)} });`);
				}
				break;
			case "browser_assert": {
				const sel = args.selector || "body";
				if (args.text) lines.push(`    await expect(page.locator(${JSON.stringify(sel)})).toContainText(${JSON.stringify(args.text)});`);
				else if (args.visible !== void 0) {
					if (args.visible) lines.push(`    await expect(page.locator(${JSON.stringify(sel)})).toBeVisible();`);
					else lines.push(`    await expect(page.locator(${JSON.stringify(sel)})).toBeHidden();`);
				}
				break;
			}
			case "browser_form_fill": {
				const fields = args.fields || {};
				for (const [k, v] of Object.entries(fields)) {
					lines.push(`    // 批量表单填充: ${k} = ${v}`);
					lines.push(`    await page.getByLabel(${JSON.stringify(k)}).fill(${JSON.stringify(String(v))}).catch(async () => {`);
					lines.push(`      await page.locator(${JSON.stringify(k)}).fill(${JSON.stringify(String(v))});`);
					lines.push(`    });`);
				}
				if (args.submitButton) {
					lines.push(`    await page.getByRole("button", { name: ${JSON.stringify(args.submitButton)} }).click().catch(async () => {`);
					lines.push(`      await page.locator(${JSON.stringify(args.submitButton)}).click();`);
					lines.push(`    });`);
				}
				break;
			}
			default: lines.push(`    // [${tool}] ${JSON.stringify(args)}`);
		}
	}
	lines.push(`  });`);
	lines.push(`});`);
	lines.push(``);
	return lines.join("\n");
}
//#endregion
//#region lib/types/browser/tools/recorder.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
/** 拾取指纹的页内提取(walker 统一元素描述结构;构建期拼装注入)。 */
const pickElementInjector = injectWalker((el, w) => {
	const d = w.describeElement(el);
	return {
		testid: d.testid !== "" ? d.testid : void 0,
		id: d.id !== "" ? d.id : void 0,
		tag: d.tag,
		role: d.role !== "" ? d.role : void 0,
		name: d.name !== "" ? d.name : void 0,
		text: d.text !== "" ? d.text : void 0
	};
});
/**
* 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
* 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
* F5 收敛:元素描述(role/name/text)改用 walker 单一来源
* (describeElement),与 aria 快照/find/录制回声共用同一套语义;相比旧
* 内联副本,role 推断更完整(slider/spinbutton/searchbox/heading 等),
* name 补齐 labelledby/label[for]/title 兜底 —— 指纹只作自愈降级候选,
* 语义增强只会让自愈命中率更高,不改变任何主链路行为。
*/
async function captureSelectorHint(page, selector) {
	return page.locator(selector).first().evaluate(pickElementInjector).catch(() => null);
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
async function recordTool(args, config, exec) {
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
		const calls = recorded !== null ? recorded : testLogOf().reverse().slice(-100);
		const includeFailed = args.includeFailed === true;
		const failedCount = includeFailed ? 0 : calls.filter((c) => c.ok === false).length;
		const rawSteps = (includeFailed ? calls : calls.filter((c) => c.ok !== false)).map((c) => {
			if (c.tool === "browser_eval" && typeof c.args?.script === "string") {
				const { script } = unwrapDoubleEncodedScript(c.args.script);
				if (script !== c.args.script) return {
					tool: c.tool,
					args: {
						...c.args,
						script
					},
					...c.meta !== void 0 ? { meta: c.meta } : {}
				};
			}
			return {
				tool: c.tool,
				args: c.args ?? {},
				...c.meta !== void 0 ? { meta: c.meta } : {}
			};
		});
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
			...failedCount > 0 ? { skippedFailed: failedCount } : {},
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
	if (action === "export") {
		if (!args.name) throw new Error("export 需要 name");
		const name = String(args.name);
		reloadRecordingIfChanged(name);
		const entry = savedRecordings.get(name);
		if (!entry) throw new Error(`录制不存在: ${name}`);
		const format = String(args.format ?? "playwright");
		if (format !== "playwright") throw new Error(`暂不支持的导出格式: ${format}(当前仅支持 playwright)`);
		const code = compileToPlaywrightSpec(entry.steps, { title: name });
		const exportPath = typeof args.exportPath === "string" && args.exportPath ? args.exportPath : void 0;
		if (exportPath) {
			const fullPath = workspaceFilePath(workspaceBaseDir(config ?? {}, exec), exportPath);
			mkdirSync(dirname(fullPath), { recursive: true });
			writeFileSync(fullPath, code, "utf-8");
			return {
				exported: true,
				format: "playwright",
				path: fullPath,
				code
			};
		}
		return {
			exported: true,
			format: "playwright",
			code
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
	let retryAttempted = 0;
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
		const canHeal = opts.healing === true && hint !== void 0 && SELECTOR_STEP_TOOLS.has(step.tool) && typeof step.args?.selector === "string";
		/** 单次完整尝试(含自愈链);返回该次尝试的 result 行(带内部 healed 标记)。 */
		const attempt = async () => {
			if (!canHeal) try {
				await impl(step.args ?? {});
				return {
					ok: true,
					result: {
						index: i,
						tool: step.tool,
						ok: true
					}
				};
			} catch (e) {
				return {
					ok: false,
					result: {
						index: i,
						tool: step.tool,
						ok: false,
						error: e instanceof Error ? e.message : String(e)
					}
				};
			}
			const healTimeout = opts.healTimeoutMs ?? 3e3;
			const quickArgs = {
				...step.args,
				timeoutMs: Math.min(Number(step.args.timeoutMs ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY, healTimeout)
			};
			try {
				await impl(quickArgs);
				return {
					ok: true,
					result: {
						index: i,
						tool: step.tool,
						ok: true
					}
				};
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
				if (healed !== null) return {
					ok: true,
					result: {
						index: i,
						tool: step.tool,
						ok: true,
						healed: true,
						via: healed.via,
						resolved: healed.selector
					}
				};
				const base = e0 instanceof Error ? e0.message : String(e0);
				return {
					ok: false,
					result: {
						index: i,
						tool: step.tool,
						ok: false,
						error: `${base}${tried.length > 0 ? `; 自愈已尝试: ${tried.join(" | ")}` : ""}`
					}
				};
			}
		};
		let outcome = await attempt();
		let recovered = false;
		if (!outcome.ok && (opts.retryFailed ?? 0) > 0) for (let n = 1; n <= (opts.retryFailed ?? 0); n++) {
			await sleep(500 * n);
			retryAttempted++;
			const again = await attempt();
			outcome = again;
			if (again.ok) {
				recovered = true;
				break;
			}
		}
		if (outcome.ok) {
			passed++;
			if (outcome.result.healed === true) healedCount++;
			results.push(recovered ? {
				...outcome.result,
				recovered: true
			} : outcome.result);
		} else {
			results.push(outcome.result);
			if (failFast) {
				stoppedAt = i;
				break;
			}
		}
	}
	return {
		total: steps.length,
		passed,
		failed: results.length - passed,
		healedCount,
		...retryAttempted > 0 ? { retries: {
			attempted: retryAttempted,
			recovered: results.filter((r) => r.recovered === true).length
		} } : {},
		...stoppedAt !== null ? { stoppedAt } : {},
		results
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
		const reloaded = reloadRecordingIfChanged(args.name);
		const saved = savedRecordings.get(args.name);
		if (saved === void 0) throw new Error(`未找到录制: ${args.name}`);
		steps = saved.steps;
		source = args.name;
		if (reloaded) source = `${args.name}(已从磁盘重载)`;
	} else if (Array.isArray(args.steps)) steps = args.steps;
	else throw new Error("replay 需要 name(已保存录制)或 steps(步骤数组)");
	if (steps.length === 0) throw new Error("步骤为空");
	const failFast = args.failFast !== false;
	const retryFailed = Math.min(Math.max(Math.floor(Number(args.retryFailed ?? 0)) || 0, 0), 10);
	const retryOf = typeof args.retryOf === "string" && args.retryOf !== "" ? args.retryOf : void 0;
	const runMeta = { ...retryFailed > 0 || retryOf !== void 0 ? {
		...retryFailed > 0 ? { retries: {
			attempted: 0,
			recovered: 0
		} } : {},
		...retryOf !== void 0 ? { retryOf } : {}
	} : {} };
	const opts = {
		healing: config?.selectorHealing !== false,
		healTimeoutMs: config?.healTimeoutMs ?? 3e3,
		...retryFailed > 0 ? { retryFailed } : {}
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
					results: [],
					...runMeta
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
				results: result.results,
				...result.retries ?? runMeta.retries,
				...runMeta.retryOf !== void 0 ? { retryOf: runMeta.retryOf } : {}
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
	const retries = result.retries;
	noteRun({
		kind: "replay",
		source,
		total: result.total,
		passed: result.passed,
		failed: result.failed,
		healedCount: result.healedCount,
		durationMs: Date.now() - t0,
		results: result.results,
		...retries !== void 0 ? { retries } : {},
		...retryOf !== void 0 ? { retryOf } : {}
	});
	return {
		source,
		...result,
		summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== void 0 ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈(建议修复录制选择器)` : ""}${retries !== void 0 && retries.recovered > 0 ? `,重试挽回 ${retries.recovered}/${retries.attempted}` : ""}`
	};
}
let rerunHandler = null;
let rerunInFlight = false;
/** registerTools 注册重跑入口(stepImpls 同路径);web-only 进程保持 null。 */
function setRerunHandler(fn) {
	rerunHandler = fn;
}
/** 当前可用的重跑入口(null = 本进程没有 tools 服务,无法重跑)。 */
function getRerunHandler() {
	return rerunHandler;
}
/** 重跑是否正在执行(端点互斥;导出供测试)。 */
function rerunBusy() {
	return rerunInFlight;
}
/** 执行一次面板重跑(busy 检查 + 互斥标记;返回 replayTool 结果)。 */
async function runPanelRerun(req) {
	if (rerunInFlight) throw Object.assign(/* @__PURE__ */ new Error("重跑进行中"), { status: 409 });
	rerunInFlight = true;
	try {
		const handler = rerunHandler;
		if (handler === null) throw Object.assign(/* @__PURE__ */ new Error("本进程无回放能力(tools 服务未注册)"), { status: 503 });
		return await handler(req);
	} finally {
		rerunInFlight = false;
	}
}
//#endregion
//#region lib/types/browser/definitions/navigation.js
function getNavigationTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
			name: "browser_context",
			description: "命名隔离上下文:同一浏览器进程内 cookies/storage 完全隔离的\"标签组\"。action:new(name 可省略自动编号,可选 url 直接打开)/ list / switch(name,激活该组页面,组内页全关则在原 context 新开,登录态仍在)/ close(name,整组关闭)。适合多账号并行验证、需要干净会话的抓取。页注册进普通标签表,所有浏览器工具直接可用;browser_tabs 也能看到/切换这些页。持久模式(userDataDir)不支持,请改用 profiles。",
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
						],
						description: "默认 list。"
					},
					name: {
						type: "string",
						description: "上下文名(new 自动编号时可省略;switch/close 必填)。"
					},
					url: {
						type: "string",
						description: "new 时可选:新页直接打开的 URL。"
					}
				},
				additionalProperties: false
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					contexts: {
						type: "array",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
								pages: { type: "integer" },
								active: { type: "boolean" },
								createdAt: { type: "integer" }
							},
							required: [
								"name",
								"pages",
								"active",
								"createdAt"
							],
							additionalProperties: false
						}
					},
					profile: { type: "string" },
					created: { type: "string" },
					navigated: { type: "string" },
					switched: { type: "string" },
					closed: { type: "string" },
					remainingTabs: { type: "integer" },
					pages: { type: "integer" },
					url: { type: "string" },
					title: { type: "string" }
				},
				required: []
			},
			render: (args, value) => {
				if (args.action === "new" || value.created) return `新建隔离上下文 "${value.created}"${value.navigated ? ` → ${value.navigated}` : ""}`;
				if (args.action === "switch" || value.switched) return `切换到上下文 "${value.switched}": ${value.url}`;
				if (args.action === "close" || value.closed) return `关闭上下文 "${value.closed}"(剩余 ${value.remainingTabs} 标签)`;
				return value.contexts.map((c) => `${c.active ? "▶" : " "} ${c.name}(${c.pages} 页)`).join("\n") || "(无隔离上下文;browser_context { action: \"new\" } 创建)";
			},
			timeoutMs: timeout(),
			execute: (args) => contextTool(config, args)
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/interaction.js
function getInteractionTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
				properties: {
					result: {},
					scriptUnwrapped: {
						type: "boolean",
						description: "入参 script 疑似被 JSON 双重序列化(以引号包裹且含 \\n 字面量),已自动解码一层。"
					}
				},
				required: ["result"]
			},
			render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
			timeoutMs: timeout(),
			execute: (args) => evalTool(config, args)
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
			name: "browser_form_fill",
			description: "智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层。",
			parameters: {
				type: "object",
				properties: {
					fields: {
						type: "object",
						description: "表单键值对映射(键支持 label/placeholder/selector, 值为待填内容)"
					},
					scope: {
						type: "string",
						description: "可选容器选择器, 限制填充范围"
					},
					submitButton: {
						type: "string",
						description: "可选, 填写完成后自动点击的提交按钮名称或选择器"
					},
					timeoutMs: { type: "integer" }
				},
				required: ["fields"],
				additionalProperties: false
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					filled: {
						type: "array",
						items: { type: "string" }
					},
					skipped: {
						type: "array",
						items: { type: "string" }
					},
					errors: { type: "object" },
					submitted: { type: "boolean" }
				},
				required: [
					"filled",
					"skipped",
					"errors"
				]
			},
			render: (_args, value) => `Filled ${value.filled.length} fields: ${value.filled.join(", ")}${value.skipped.length > 0 ? ` (skipped: ${value.skipped.join(", ")})` : ""}${value.submitted ? " [Submitted]" : ""}`,
			timeoutMs: timeout(),
			execute: (args) => formFillTool(config, args)
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/inspection.js
function getInspectionTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
			name: "browser_snapshot",
			description: "读取当前页面快照(不截图)。mode:'text'(默认)返回压缩后的可见文本+链接清单,适合读内容;'aria' 返回可访问性树,可交互元素带 [ref=eN] 短引用,后续 browser_click/browser_type/browser_select/browser_press 可直接传 ref 代替 CSS 选择器(导航或重新快照后旧 ref 失效)。maxTextChars 默认 20000。scope:可选 CSS 选择器,只对命中的容器区域提取(text/aria 两种模式都生效,scope 未命中报错)。since:增量模式,传之前任一次快照返回的 contentVersion——历史版本环形缓存(snapshotHistory 默认 5,可配 1-20)窗口内的任意版本都能 diff:内容未变返回 { unchanged: true },变了只返回相对该版本的变化行(diff: true, changedFrom/removed 标注变化区),表格翻页/局部刷新/轮询抓取后重读 token 开销可降一个量级;since 超出窗口(过旧/未知)则回落全量并标 stale。",
			parameters: {
				type: "object",
				properties: {
					mode: {
						type: "string",
						enum: ["text", "aria"],
						description: "快照模式,默认 text。"
					},
					scope: {
						type: "string",
						description: "可选:限定提取区域的 CSS 选择器(如 '#main')。"
					},
					since: {
						type: "integer",
						description: "可选:之前任一次快照的 contentVersion(历史窗口内任意版本),只返回相对该版本的变化内容。"
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
					},
					viewportOnly: {
						type: "boolean",
						description: "仅提取当前视口内可见元素(几何相交剪枝),大幅节省 Token。"
					},
					viewportPadding: {
						type: "integer",
						description: "视口外边缘扩展预加载边距(像素)。"
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
					tree: { type: "string" },
					truncated: { type: "boolean" },
					links: {
						type: "array",
						items: { type: "object" }
					},
					inputs: { type: "integer" },
					refs: { type: "integer" },
					scope: { type: "string" },
					contentVersion: { type: "integer" },
					unchanged: { type: "boolean" },
					diff: { type: "boolean" },
					changedFrom: { type: "integer" },
					removed: { type: "integer" },
					stale: { type: "boolean" },
					viewportOnly: { type: "boolean" },
					prunedCount: { type: "integer" }
				},
				required: [
					"url",
					"title",
					"truncated"
				]
			},
			render: (_args, value) => {
				if (value.unchanged === true) return `页面未变化(版本 v${value.contentVersion}): ${value.url}`;
				if (value.diff === true) {
					const body = value.tree !== void 0 ? value.tree : value.text;
					return `内容变化(v${value.contentVersion},第 ${value.changedFrom} 行起,删除 ${value.removed} 行):\n${body}`;
				}
				if (value.tree !== void 0) return `URL: ${value.url}\nTitle: ${value.title}\nRefs: ${value.refs}\nVersion: v${value.contentVersion}${value.stale === true ? "(stale)" : ""}\n--- aria tree ---\n${value.tree}`;
				return `URL: ${value.url}\nTitle: ${value.title}\nInputs: ${value.inputs}\nVersion: v${value.contentVersion}${value.stale === true ? "(stale)" : ""}\n--- text ---\n${value.text}`;
			},
			timeoutMs: timeout(),
			execute: (args) => snapshotTool(config, args)
		}),
		definePlainTool({
			name: "browser_find",
			description: "按名称/id/data-testid 语义定位页面元素,只返回命中的 ref + 区域上下文,不输出全量 aria 树 —— 在大页面定位单个操作目标时比 browser_snapshot { mode: \"aria\" } 省 95% 以上 token。返回的 ref 可直接传给 browser_click / browser_type / browser_select / browser_press。默认包含匹配(query 是名称子串,忽略大小写;exact:true 精确匹配);scope 限定查找容器;多命中全部返回并附 ancestors 区域链供二次定位;零命中不抛错,返回最相近的 suggestions 候选。",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "要找的元素名称(如「提交」「登录」),或元素 id / data-testid。"
					},
					exact: {
						type: "boolean",
						description: "true 时名称需完全相等(默认 false 包含匹配)。"
					},
					scope: {
						type: "string",
						description: "可选:限定查找的容器 CSS 选择器(如 '#login-form')。"
					}
				},
				required: ["query"],
				additionalProperties: false
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					found: { type: "integer" },
					matches: {
						type: "array",
						items: {
							type: "object",
							properties: {
								ref: { type: "string" },
								role: { type: "string" },
								name: { type: "string" },
								ancestors: {
									type: "array",
									items: { type: "string" }
								}
							},
							required: [
								"ref",
								"role",
								"name",
								"ancestors"
							],
							additionalProperties: false
						}
					},
					suggestions: {
						type: "array",
						items: {
							type: "object",
							properties: {
								role: { type: "string" },
								name: { type: "string" },
								score: { type: "integer" }
							},
							required: [
								"role",
								"name",
								"score"
							],
							additionalProperties: false
						}
					},
					truncated: { type: "boolean" },
					scanned: { type: "integer" },
					url: { type: "string" },
					title: { type: "string" }
				},
				required: [
					"found",
					"matches",
					"scanned",
					"url",
					"title"
				]
			},
			render: (args, value) => {
				const hits = value.matches.map((m) => `${m.ref}=${m.role} "${m.name}"`).join(", ");
				if (value.found > 0) return `找到 ${value.found} 个「${args.query}」: ${hits}${value.found > 10 ? " …" : ""}`;
				const sugg = (value.suggestions ?? []).map((s) => `${s.role} "${s.name}"`).join("、");
				return `未找到「${args.query}」(扫描 ${value.scanned} 个元素)${sugg ? `;相近候选: ${sugg}` : ""}`;
			},
			timeoutMs: timeout(),
			execute: (args) => findTool(config, args)
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
					},
					som: {
						type: "boolean",
						description: "启用 Set-of-Marks 视口标徽, 在可交互元素上绘制数字徽章。"
					},
					somColor: {
						type: "string",
						enum: [
							"red",
							"blue",
							"green"
						],
						description: "标徽主题色(默认 red)。"
					},
					maxMarks: {
						type: "integer",
						description: "标徽数量上限, 默认 50。"
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
					baseline: { type: "string" },
					som: { type: "boolean" },
					somMarks: {
						type: "array",
						items: { type: "object" }
					}
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
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/testing.js
function getTestingTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		}),
		definePlainTool({
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
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/collaboration.js
function getCollaborationTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
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
			timeoutMs: timeout(6e5),
			execute: (args) => waitForLoginTool(config, args)
		}),
		definePlainTool({
			name: "browser_pause_for_human",
			description: "人工接管等待:agent 把控制权暂时交还给用户,适用于验证码/短信确认/二次复核/敏感步骤人工兜底等场景。调用后提示(instruction)会显示在界面右下角实时画面面板,等待用户在浏览器窗口中完成操作。完成条件三选一:successSelector(完成后出现的元素)、successUrl(完成后 URL 匹配的正则),都不给则 URL 或页面内容发生变化即视为完成。轮询间隔 2 秒;超时不抛错,返回 completed:false,agent 可再次调用或改走其他路径。",
			parameters: {
				type: "object",
				properties: {
					instruction: {
						type: "string",
						description: "给用户看的提示语,如「请在浏览器中输入短信验证码」。"
					},
					timeoutMs: {
						type: "integer",
						description: "等待上限(毫秒,默认 300000,下限 1000,上限 600000)。"
					},
					successSelector: {
						type: "string",
						description: "完成后应出现的 CSS 选择器。"
					},
					successUrl: {
						type: "string",
						description: "完成后 URL 应匹配的正则。"
					}
				},
				required: ["instruction"],
				additionalProperties: false
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					completed: { type: "boolean" },
					status: {
						type: "string",
						enum: ["completed", "timedOut"]
					},
					instruction: { type: "string" },
					detail: { type: "string" },
					waitedMs: { type: "integer" },
					url: { type: "string" },
					title: { type: "string" }
				},
				required: [
					"completed",
					"status",
					"instruction",
					"detail",
					"waitedMs",
					"url",
					"title"
				]
			},
			render: (_args, value) => value.completed ? `人工操作完成(${value.waitedMs}ms): ${value.url}` : `等待人工操作超时(${value.waitedMs}ms): ${value.instruction} — ${value.detail}`,
			timeoutMs: timeout(6e5),
			execute: (args) => pauseForHumanTool(config, args)
		}),
		definePlainTool({
			name: "browser_confirm",
			description: "敏感操作审批:在执行提交/删除/支付等不可逆或影响线上数据的动作前调用,审批请求(含 reason 与将执行的操作)会推送到界面右下角实时画面面板,等待用户点「允许/拒绝」。用户允许时返回 decision:'allowed';用户拒绝或等待超时(默认 60s,fail-closed)**抛错**,live 调用与 replay/batch 步骤统一按失败处理。confirmMode:'manual' 时 systemPrompt 会要求所有敏感动作前必须先过本工具。",
			parameters: {
				type: "object",
				properties: {
					reason: {
						type: "string",
						description: "给用户看的审批理由:要执行什么操作、影响是什么。"
					},
					tool: {
						type: "string",
						description: "可选:即将执行的工具名,如 'browser_click'。"
					},
					args: {
						type: "object",
						description: "可选:即将执行的工具参数(如 { selector: '#submit' }),供面板展示。"
					},
					timeoutMs: {
						type: "integer",
						description: "等待决策上限(毫秒,默认取配置 confirmTimeoutMs=60000,下限 1000,上限 600000)。"
					}
				},
				required: ["reason"],
				additionalProperties: false
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					decision: {
						type: "string",
						enum: ["allowed"]
					},
					id: { type: "string" },
					reason: { type: "string" },
					waitedMs: { type: "integer" },
					detail: { type: "string" }
				},
				required: [
					"decision",
					"id",
					"reason",
					"waitedMs",
					"detail"
				]
			},
			render: (_args, value) => `用户允许执行(${value.waitedMs}ms): ${value.reason}`,
			timeoutMs: timeout(6e5),
			execute: (args) => confirmTool(config, args)
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/doctor.js
function getDoctorTools(config, timeout, stepImpls) {
	return [definePlainTool({
		name: "browser_doctor",
		description: "浏览器环境健康诊断(不启动浏览器):检查可执行文件/channel、playwright-core 可用性、userDataDir 与截图/下载/基线目录写权限、工作区基准目录解析来源、当前会话状态、面板 API 可达性。环境异常(文件落错位置/浏览器起不来)时先跑本工具定位,每项失败检查附修复建议。",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				checks: {
					type: "array",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							ok: { type: "boolean" },
							detail: { type: "string" },
							advice: { type: "string" }
						},
						required: [
							"name",
							"ok",
							"detail"
						],
						additionalProperties: false
					}
				},
				summary: {
					type: "object",
					properties: {
						ok: { type: "boolean" },
						passed: { type: "integer" },
						failed: { type: "integer" }
					},
					required: [
						"ok",
						"passed",
						"failed"
					],
					additionalProperties: false
				}
			},
			required: ["checks", "summary"]
		},
		render: (_args, value) => {
			const lines = value.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}${c.advice ? `\n    建议: ${c.advice}` : ""}`);
			return `诊断 ${value.summary.ok ? "通过" : "发现问题"}(${value.summary.passed}/${value.checks.length})\n${lines.join("\n")}`;
		},
		timeoutMs: timeout(15e3),
		execute: (args, exec) => doctorTool(config, args, exec)
	})];
}
//#endregion
//#region lib/types/browser/definitions/recorder.js
function getRecorderTools(config, timeout, stepImpls) {
	return [
		definePlainTool({
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
							"delete",
							"export"
						],
						description: "默认 start。"
					},
					name: {
						type: "string",
						description: "save/delete/export 时的录制名。"
					},
					stripReads: {
						type: "boolean",
						description: "save 时剔除只读步骤(snapshot/elements/eval/network/status/cookies list),默认 false。"
					},
					includeFailed: {
						type: "boolean",
						description: "save 时保留失败的实验步骤(默认剔除:超时/无效 selector 的步骤回放必然再次失败并卡住回放)。"
					},
					vars: {
						type: "object",
						description: "save 时参数化:{ 变量名: \"#步骤号.args.字段\" }(步骤号 1 起),该字段值替换为 {{变量名}} 占位符;replay 时用 vars 传入真实值。"
					},
					format: {
						type: "string",
						enum: ["playwright"],
						description: "export 时的目标格式, 默认 playwright。"
					},
					exportPath: {
						type: "string",
						description: "export 时的输出文件路径(相对工作区)。"
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
					skippedFailed: {
						type: "integer",
						description: "save 时默认剔除的失败实验步骤数。"
					},
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
					hint: { type: "string" },
					exported: { type: "boolean" },
					format: { type: "string" },
					path: { type: "string" },
					code: { type: "string" }
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
				if (args.action === "export") return value.path ? `已导出 Playwright 规范测试用例: ${value.path}` : `已生成 Playwright 规范测试代码:\n${value.code}`;
				return (value.recordings ?? []).map((r) => `"${r.name}"(${r.steps} 步): ${r.preview}`).join("\n") || "(无录制)";
			},
			timeoutMs: timeout(),
			execute: (args, exec) => recordTool(args, config, exec)
		}),
		definePlainTool({
			name: "browser_replay",
			description: "回放录制或步骤序列(回归测试):name 指定已保存录制(browser_record save),或直接传 steps 数组(每步 {tool, args})。failFast 默认 true(遇错停止);返回每步结果与汇总。选择器自愈:录制时保存了元素指纹的步骤,原 selector 失败时自动按 testid→role+name→text→id 降级重试并在结果中标 healed(建议事后修复录制选择器)。参数化:录制含 {{占位符}} 时用 vars 注入;data 传对象数组或 dataFile 传 CSV 路径(首行为变量名)可逐行数据驱动回放。retryFailed: N 使失败步骤(自愈链耗尽后)自动重试 N 次(500ms×n 线性退避,重试耗尽才停),返回值 retries 标注 { attempted, recovered }。运行结果自动记入回归历史(browser_report 可导出报告)。",
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
					},
					retryFailed: {
						type: "integer",
						description: "失败步骤自动重试次数(0-10,默认 0;500ms×n 线性退避,重试耗尽才停)。偶发超时/网络抖动类失败的兜底。"
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
					retries: {
						type: "object",
						description: "自动重试统计 { attempted, recovered }(仅 retryFailed>0 时返回)。"
					},
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
				return value.runs !== void 0 ? `${value.summary}\n${value.runs.map((r) => `${(r.failed ?? 0) === 0 ? "✓" : "✗"} 行${r.row}${r.error ? ` — ${String(r.error).slice(0, 100)}` : ` ${r.passed}/${r.total}`}`).join("\n")}` : `${value.summary}\n${(value.results ?? []).map((r) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.healed ? ` [自愈:${r.via}]` : ""}${r.recovered ? " [重试挽回]" : ""}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`;
			},
			timeoutMs: timeout(6e5),
			execute: (args, exec) => replayTool(args, stepImpls, config, exec)
		}),
		definePlainTool({
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
			timeoutMs: timeout(6e5),
			execute: (args) => batchTool(args, stepImpls)
		}),
		definePlainTool({
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
		})
	];
}
//#endregion
//#region lib/types/browser/definitions/extract.js
function getExtractTools(config, timeout, stepImpls) {
	return [definePlainTool({
		name: "browser_extract",
		description: "规则化结构化抽取(网站信息获取):fields 定义抽取结构 [{name, selector, attr?, multiple?, fields?}](attr 缺省取可见文本,可指定 href/src 等属性;multiple=true 收集所有命中;fields 嵌套可在行内抽子字段);next 传翻页选择器自动翻页聚合(maxPages 上限,next 消失/禁用即停);format 支持 json/csv/jsonl/markdown,file 落盘到工作区(自动按扩展名推断格式,拒绝路径穿越)。action:\"suggest\"(不传 fields)自动推断字段:从命中容器首条记录(表格首行/列表卡片)推断单元格文本/链接 href/图片 src 结构,返回建议 fields + 首行样本,确认/微调后直接交给抽取模式(往返 3-4 次降到 2 次);推断不出规律结构时返回原因与容器元素概览,不猜。语义化抽取(如「总结要点」)不在此工具范围——用 browser_snapshot 读文本后交 jev_extract。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["suggest"],
					description: "suggest:自动推断字段结构,返回建议 fields + 样本(此模式不传 fields)。"
				},
				scope: {
					type: "string",
					description: "suggest 模式的容器选择器(缺省整页;表格/列表探测在此范围内进行)。"
				},
				fields: {
					type: "array",
					items: { type: "object" },
					description: "抽取字段定义 [{name, selector, attr?, multiple?, fields?}](action:suggest 时不传)。"
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
			required: [],
			additionalProperties: false
		},
		outputSchema: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: { type: "string" },
				suggested: { type: "boolean" },
				kind: { type: "string" },
				rowSelector: { type: "string" },
				headerTexts: {
					type: "array",
					items: { type: "string" }
				},
				fields: {
					type: "array",
					items: { type: "object" }
				},
				sample: { type: "object" },
				reason: { type: "string" },
				overview: { type: "object" },
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
			required: ["url", "title"]
		},
		render: (_args, value) => value.action === "suggest" ? value.suggested ? `字段建议(${value.kind}):行选择器 ${value.rowSelector},${value.fields[0].fields.length} 个字段;样例 ${JSON.stringify(value.sample).slice(0, 120)}` : `字段建议失败: ${String(value.reason).slice(0, 120)}` : `抽取 ${value.count} 行 / ${value.pages} 页${value.truncated ? "(已截断)" : ""}${value.file ? ` → ${value.file} (${value.bytes} bytes)` : ""}`,
		timeoutMs: timeout(),
		execute: (args, exec) => extractTool(config, args, exec)
	})];
}
//#endregion
//#region lib/types/browser/register.js
function registerTools(ctx, config) {
	const tools = ctx.get("tools");
	if (tools === void 0) return;
	setToolsLogger((m) => ctx.logger?.info?.(m));
	const timeout = (ms) => ms ?? config.timeoutMs ?? 3e4;
	/** 会触发真实 DOM 事件的 agent 工具:执行前后打点,混合录制时用于区分人手与工具回声。 */
	const AGENT_DOM_TOOLS = /* @__PURE__ */ new Set([
		"browser_click",
		"browser_type",
		"browser_select",
		"browser_press",
		"browser_upload",
		"browser_form",
		"browser_form_fill",
		"browser_eval"
	]);
	/** 操作预告:这些工具执行前把目标元素在实时画面上高亮(异步不阻塞)。 */
	const PREVIEW_TOOLS = /* @__PURE__ */ new Set([
		"browser_click",
		"browser_type",
		"browser_select",
		"browser_press"
	]);
	/**
	* auto 审批闸(confirmMode:"auto" 硬约束):live 调用在 register 包装层拦,
	* replay/batch 在 stepImpls 外再包一层(默认同样拦截;confirmInReplay: false
	* 可关,README 注明风险)。未命中模式时闸内只花一次页内 evaluate。
	*/
	const replayGate = (tool, fn) => async (a) => {
		if (config.confirmMode === "auto" && config.confirmInReplay !== false) await confirmGate(config, tool, a);
		return fn(a);
	};
	/**
	* toolset: "core" 的高频核心集:浏览/定位/操作/等待/断言/人机协作。
	* 低频的录制/回放/报告/抽取/表单回放/profile/context 等只在 "all" 注册。
	*/
	const CORE_TOOLS = /* @__PURE__ */ new Set([
		"browser_open",
		"browser_snapshot",
		"browser_find",
		"browser_elements",
		"browser_click",
		"browser_type",
		"browser_press",
		"browser_select",
		"browser_eval",
		"browser_batch",
		"browser_wait",
		"browser_wait_for",
		"browser_assert",
		"browser_screenshot",
		"browser_wait_for_login",
		"browser_pause_for_human",
		"browser_confirm",
		"browser_network",
		"browser_tabs",
		"browser_download",
		"browser_upload",
		"browser_status",
		"browser_doctor",
		"browser_close"
	]);
	/** 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。 */
	function register(def) {
		if (config.toolset === "core" && !CORE_TOOLS.has(def.name)) return;
		const original = def.execute;
		def.execute = async (args, exec) => {
			const t0 = Date.now();
			noteToolStart();
			const domTool = AGENT_DOM_TOOLS.has(def.name);
			if (domTool) noteAgentAction();
			if (config.confirmMode === "auto") await confirmGate(config, def.name, args);
			if (PREVIEW_TOOLS.has(def.name)) {
				const page = activePage();
				const selector = typeof args?.selector === "string" && args.selector ? args.selector : typeof args?.ref === "string" && args.ref && page !== null ? pageRef(page, args.ref)?.selector ?? "" : "";
				if (selector !== "") previewHighlight(page, selector, `${def.name.replace(/^browser_/, "")} ${args?.ref ? `[${args.ref}] ` : ""}${args?.key ?? args?.value ?? args?.text ?? ""}`.trim());
			}
			try {
				const result = await original(args, exec);
				const call = recordCall({
					tool: def.name,
					args,
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
				return result;
			} catch (error) {
				recordCall({
					tool: def.name,
					args,
					ok: false,
					ms: Date.now() - t0,
					ts: Date.now(),
					error: error instanceof Error ? error.message : String(error)
				});
				throw error;
			} finally {
				if (domTool) noteAgentAction();
				noteToolEnd();
			}
		};
		tools.register(def);
	}
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
		browser_form_fill: (a) => formFillTool(config, a),
		browser_profile: (a) => profileTool(config, a),
		browser_elements: (a) => elementsTool(config, a),
		browser_wait_for_login: (a) => waitForLoginTool(config, a),
		browser_pause_for_human: (a) => pauseForHumanTool(config, a),
		browser_confirm: (a) => confirmTool(config, a),
		browser_find: (a) => findTool(config, a),
		browser_doctor: (a) => doctorTool(config, a, void 0),
		browser_context: (a) => contextTool(config, a),
		browser_wait_for: (a) => waitForTool(config, a),
		browser_assert: (a) => assertTool(config, a, void 0),
		browser_network: (a) => networkTool(a),
		browser_record: (a) => recordTool(a),
		browser_replay: (a) => replayTool(a, stepImpls, config),
		browser_batch: (a) => batchTool(a, stepImpls, config),
		browser_extract: (a) => extractTool(config, a)
	};
	for (const name of Object.keys(stepImpls)) {
		const fn = stepImpls[name];
		stepImpls[name] = replayGate(name, fn);
	}
	setRerunHandler((req) => replayTool({
		name: req.source,
		...req.retryOf !== void 0 ? { retryOf: req.retryOf } : {}
	}, stepImpls, config));
	const toolFactories = [
		getNavigationTools(config, timeout),
		getInteractionTools(config, timeout),
		getInspectionTools(config, timeout),
		getTestingTools(config, timeout),
		getCollaborationTools(config, timeout),
		getDoctorTools(config, timeout),
		getExtractTools(config, timeout),
		getRecorderTools(config, timeout, stepImpls)
	];
	for (const toolList of toolFactories) for (const def of toolList) register(def);
}
//#endregion
//#region lib/types/browser/ui.js
/** 展示层参数截断:单字段 JSON 超过 300 字符截断(仅用于面板轨迹显示,不进录制)。 */
function truncateForDisplay(args) {
	if (typeof args !== "object" || args === null) return args;
	const out = {};
	for (const [k, v] of Object.entries(args)) {
		const s = JSON.stringify(v);
		out[k] = s && s.length > 300 ? `${s.slice(0, 300)}…(截断)` : v;
	}
	return out;
}
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
				sendJson(res, 200, {
					...await statusTool(),
					pause: currentPause()
				});
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
					calls: testLogOf().slice(0, 50).map((c) => ({
						...c,
						args: truncateForDisplay(c.args)
					}))
				});
				return;
			}
			if (path === `${base}/runs/latest`) {
				sendJson(res, 200, {
					run: latestRun(),
					busy: activeToolCalls() > 0 || rerunBusy()
				});
				return;
			}
			if (path === `${base}/runs/rerun`) {
				if ((req.method ?? "GET") !== "POST") {
					sendText(res, 405, "POST only");
					return;
				}
				if (activeToolCalls() > 0 || rerunBusy()) {
					sendJson(res, 409, { error: "agent 忙碌(有工具调用或回放在进行),稍后重试" });
					return;
				}
				if (getRerunHandler() === null) {
					sendJson(res, 503, { error: "本进程无回放能力(tools 服务未注册)" });
					return;
				}
				const body = await readJsonBody(req).catch(() => void 0);
				const source = typeof body?.source === "string" ? body.source.trim() : "";
				if (!source) {
					sendJson(res, 400, "source required");
					return;
				}
				try {
					sendJson(res, 200, {
						ok: true,
						result: await runPanelRerun({
							source,
							...typeof body?.retryOf === "string" && body.retryOf !== "" ? { retryOf: body.retryOf } : {}
						})
					});
				} catch (e) {
					sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
				}
				return;
			}
			if (path === `${base}/runs/report`) {
				let source = "";
				try {
					source = new URL(req.url ?? "/", "http://x").searchParams.get("source") ?? "";
				} catch {}
				if (source === "") source = latestRun()?.source ?? "";
				const html = renderHtmlReport(listRuns(50).filter((r) => source === "" ? true : r.source === source), source === "" ? void 0 : source);
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
					"content-length": Buffer.byteLength(html)
				});
				res.end(html);
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
			if (path === `${base}/confirm`) {
				if ((req.method ?? "GET") === "POST") {
					const body = await readJsonBody(req).catch(() => void 0);
					const id = typeof body?.id === "string" ? body.id : "";
					const decision = body?.decision === "allowed" || body?.decision === "denied" ? body.decision : void 0;
					if (!id || decision === void 0) {
						sendText(res, 400, "id and decision (allowed|denied) required");
						return;
					}
					sendJson(res, 200, {
						resolved: resolveConfirm(id, decision),
						id,
						decision
					});
					return;
				}
				sendJson(res, 200, { confirm: getPendingConfirm() });
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
	},
	snapshotHistory: {
		type: "number",
		min: 1,
		max: 20
	},
	confirmMode: {
		type: "string",
		enum: [
			"off",
			"manual",
			"auto"
		]
	},
	confirmTimeoutMs: {
		type: "number",
		min: 1e3
	},
	sensitivePatterns: { type: "string[]" },
	sensitiveTools: { type: "string[]" },
	confirmInReplay: { type: "boolean" },
	toolset: {
		type: "string",
		enum: ["core", "all"]
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
	maxRows: 1e3,
	snapshotHistory: 5,
	confirmMode: "off",
	confirmTimeoutMs: 6e4,
	sensitivePatterns: [
		"提交",
		"删除",
		"支付"
	],
	sensitiveTools: ["browser_click"],
	confirmInReplay: true,
	toolset: "all"
};
function apply(ctx, rawConfig) {
	const resolved = resolveConfig("dsh-browser-view", SCHEMA, DEFAULT_CONFIG, rawConfig);
	if (resolved.enabled === false) return;
	const config = resolved;
	const base = (config.basePath ?? "/browser").replace(/\/+$/, "");
	const loadedRecordings = loadRecordings();
	if (loadedRecordings > 0) ctx.logger?.info?.(`dsh-browser-view: loaded ${loadedRecordings} saved recording(s)`);
	registerTools(ctx, config);
	const systemPrompt = ctx.get("systemPrompt");
	const confirmGuidance = config.confirmMode === "manual" ? "本环境 confirmMode 为 manual:凡提交/删除/支付等不可逆或影响线上数据的敏感动作,执行前必须先调用 browser_confirm(reason 说明操作与影响,等待用户在实时画面面板点允许/拒绝;拒绝或超时即放弃该动作,不得换路径绕过)。" : config.confirmMode === "auto" ? "本环境 confirmMode 为 auto:宿主层已在敏感动作(命中敏感模式的目标元素)前强制弹审批卡,agent 无法绕过;审批被拒绝或超时的动作不可换路径重试,应向用户说明并等待指示。" : "";
	const sectionDispose = systemPrompt?.section?.({
		name: "tool:browser",
		order: 200,
		text: (config.toolset === "core" ? "浏览器工具操作一个共享浏览器会话(toolset=core:已精简工具集)。打开页面后用 browser_snapshot 读内容(scope 限定区域、since 增量重读省 token),定位操作元素优先 browser_find(query 传名称,返回 ref);点击/输入/按键/下拉用 browser_click/browser_type/browser_press/browser_select(selector 或 ref);固定小序列用 browser_batch;等待用 browser_wait/browser_wait_for,断言用 browser_assert;接口检查用 browser_network;标签 browser_tabs;下载/上传 browser_download/browser_upload。需要人工:登录用 browser_wait_for_login,验证码/二次确认用 browser_pause_for_human,敏感动作(提交/删除/支付)前用 browser_confirm。环境异常先跑 browser_doctor 诊断。录制/回放/报告/抽取/profile/隔离 context 等工具当前未注册(toolset=core),需要时把配置改为 toolset: all 并重启 DSH。用户可通过界面右下角面板的实时画面查看浏览器。" : "浏览器工具操作一个共享浏览器会话,支持多标签页与多配置文件。打开页面后先用 browser_snapshot 读文本与链接、browser_elements 读表单结构(含关联 label 与展开的下拉选项),再决定 browser_click / browser_type / browser_form;定位操作元素优先用 browser_find(query 传名称,只返回命中 ref+区域上下文,大页面最省 token;零命中会给相近候选),需要全页结构时再用 browser_snapshot { mode: \"aria\" }(可交互元素带 ref=eN,click/type/select/press 直接传 ref 代替 CSS 选择器);下拉选择(原生 select 与 antd/element 组件库)用 browser_select 传 selector/ref + option 文本一步完成;固定小序列(点击→等待→输入→提交)用 browser_batch 一次执行减少往返;标签管理用 browser_tabs;下载用 browser_download(wait=true 可等新下载);登录态用 browser_cookies。做自动化测试时:用 browser_wait_for 显式等待页面稳定/元素出现,用 browser_assert 断言(失败自动截图;visual={baseline} 可做视觉回归,先用 browser_screenshot { baseline } 建基线),用 browser_network 检查接口调用与 4xx/5xx,跑完一轮可用 browser_record save 保存操作序列、browser_replay 回放做回归(选择器失效自动按指纹自愈;vars/data 支持参数化与数据驱动)。每次 replay/batch 都记入运行历史,browser_report list/export 可查看与导出回归报告。抓取结构化数据用 browser_extract(fields 定义 CSS 字段,可翻页,可导出 CSV/JSONL)。遇到需要登录的网站:先 browser_open 打开登录页,告知用户请在浏览器窗口中完成登录,再调用 browser_wait_for_login 等待(可给 successSelector/successUrl);验证码/二次确认等更广的「人补一步」场景用 browser_pause_for_human(提示语会显示在实时画面面板);配置 userDataDir 时登录态会持久化。用户可通过界面右下角面板的实时画面查看浏览器。") + confirmGuidance
	});
	if (sectionDispose !== void 0) ctx.effect(() => sectionDispose);
	registerBrowserApi(ctx, config, base);
	const webServer = ctx.get("webServer");
	if (webServer !== void 0) {
		const port = webServer.port;
		setDoctorProbe(port !== void 0 ? async (basePath) => {
			try {
				const res = await fetch(`http://127.0.0.1:${port}${basePath}/status`, {
					signal: AbortSignal.timeout(2e3),
					cache: "no-store"
				});
				return res.ok ? {
					ok: true,
					detail: `面板 API 可达(/status → 200,端口 ${port})`
				} : {
					ok: false,
					detail: `面板 API 异常(/status → ${res.status})`,
					advice: "查看 DSH 日志中 webServer 的注册错误"
				};
			} catch (e) {
				return {
					ok: false,
					detail: `本机 127.0.0.1:${port} 请求失败: ${e instanceof Error ? e.message : String(e)}`,
					advice: "确认 DSH web 端口未被防火墙/代理拦截"
				};
			}
		} : null);
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
