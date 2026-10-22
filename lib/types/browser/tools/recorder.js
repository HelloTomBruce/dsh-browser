// dsh-browser · 浏览器工具 — 录制、自愈回放、批处理与报告
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { savedRecordings, startRecording, stopRecording, lastRecordingOf, testLogOf, isRecording, } from "../session.js";
import { saveRecordingFile, listRecordings, deleteRecording, reloadRecordingIfChanged, } from "../recordings.js";
import { appendRun, listRuns, getRun, latestRun, makeRunId, renderMarkdownReport, renderHtmlReport, } from "../reports.js";
import { parseCsv } from "../extract.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { injectWalker } from "../walker.js";
import { workspaceFilePath, unwrapDoubleEncodedScript } from "./common.js";
import { compileToPlaywrightSpec } from "../codegen/playwright.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 只读工具集合:stripReads 保存时剔除(browser_cookies 仅 list 动作算只读)。 */
const READONLY_TOOLS = new Set([
    "browser_snapshot",
    "browser_elements",
    "browser_eval",
    "browser_network",
    "browser_status",
]);
function isReadonlyStep(step) {
    if (READONLY_TOOLS.has(step.tool))
        return true;
    if (step.tool === "browser_cookies")
        return (step.args?.action ?? "list") === "list";
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
/** 拾取指纹的页内提取(walker 统一元素描述结构;构建期拼装注入)。 */
const pickElementInjector = injectWalker((el, w) => {
    const d = w.describeElement(el);
    return {
        testid: d.testid !== "" ? d.testid : undefined,
        id: d.id !== "" ? d.id : undefined,
        tag: d.tag,
        role: d.role !== "" ? d.role : undefined,
        name: d.name !== "" ? d.name : undefined,
        text: d.text !== "" ? d.text : undefined,
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
export async function captureSelectorHint(page, selector) {
    return page
        .locator(selector)
        .first()
        .evaluate(pickElementInjector)
        .catch(() => null);
}
/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
export function healCandidates(hint) {
    const out = [];
    const q = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
export async function recordTool(args, config, exec) {
    const action = args.action ?? "start";
    if (action === "start") {
        startRecording();
        return { recording: true, hint: "后续浏览器工具调用将记录;用 browser_record stop 结束,再 save <name> 保存" };
    }
    if (action === "stop") {
        if (!isRecording())
            throw new Error("当前没有录制");
        const steps = stopRecording();
        return { recording: false, steps: steps.length };
    }
    if (action === "save") {
        if (isRecording())
            throw new Error("录制未结束:先 browser_record stop");
        const name = String(args.name ?? "");
        if (!name)
            throw new Error("save 需要 name");
        // 数据源:优先最近一次完整录制(start→stop);从未录制则回退到全局轨迹最近 100 条。
        // 默认剔除失败的实验步骤(ok=false:超时的 select、无效 selector 的 click 等)——
        // 它们回放必然重蹈失败,还会因超时把整个回放卡住。includeFailed=true 可保留。
        const recorded = lastRecordingOf();
        const source = recorded !== null ? "recording" : "recent-log";
        const calls = recorded !== null ? recorded : testLogOf().reverse().slice(-100);
        const includeFailed = args.includeFailed === true;
        const failedCount = includeFailed ? 0 : calls.filter((c) => c.ok === false).length;
        const usable = includeFailed ? calls : calls.filter((c) => c.ok !== false);
        const rawSteps = usable.map((c) => {
            // browser_eval:入参 script 若被 JSON 双重序列化,保存前解码,录制文件保持干净。
            if (c.tool === "browser_eval" && typeof c.args?.script === "string") {
                const { script } = unwrapDoubleEncodedScript(c.args.script);
                if (script !== c.args.script)
                    return { tool: c.tool, args: { ...c.args, script }, ...(c.meta !== undefined ? { meta: c.meta } : {}) };
            }
            return { tool: c.tool, args: c.args ?? {}, ...(c.meta !== undefined ? { meta: c.meta } : {}) };
        });
        // stripReads: 剔除只读探查步骤(snapshot/elements/eval/network/status/cookies list),
        // 让回放更聚焦操作路径。注意 browser_eval 可能有副作用,默认关闭由调用方判断。
        const steps = args.stripReads === true ? rawSteps.filter((s) => !isReadonlyStep(s)) : rawSteps;
        const stripped = rawSteps.length - steps.length;
        // 参数化:vars = { 变量名: "#步骤号.args.字段路径" }(步骤号 1 起),
        // 把指定字段的值替换为 {{变量名}} 占位符,回放时由 browser_replay 注入真实值。
        let varsApplied = 0;
        if (args.vars !== undefined && typeof args.vars === "object" && args.vars !== null) {
            for (const [varName, path] of Object.entries(args.vars)) {
                const m = /^#(\d+)\.args\.([\w.]+)$/.exec(String(path));
                if (m === null)
                    throw new Error(`vars.${varName}: 路径格式应为 "#步骤号.args.字段"(如 "#3.args.text"),实际: ${String(path)}`);
                const idx = Number(m[1]) - 1;
                const step = steps[idx];
                if (step === undefined)
                    throw new Error(`vars.${varName}: 步骤 #${m[1]} 不存在(共 ${steps.length} 步)`);
                setPath(step.args, m[2], `{{${varName}}}`);
                varsApplied++;
            }
        }
        savedRecordings.set(name, { steps, savedAt: Date.now() });
        const file = saveRecordingFile(name, steps);
        // 外部依赖检查:upload 步骤引用的本地文件不存在时预警(回放将失败)。
        const warnings = [];
        steps.forEach((s, i) => {
            if (s.tool !== "browser_upload")
                return;
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
            ...(failedCount > 0 ? { skippedFailed: failedCount } : {}),
            ...(varsApplied > 0 ? { varsApplied } : {}),
            ...(warnings.length > 0 ? { warnings } : {}),
            hint: "已持久化到磁盘,重启 DSH 后仍可回放",
        };
    }
    if (action === "list") {
        return { recordings: listRecordings() };
    }
    if (action === "delete") {
        if (!args.name)
            throw new Error("delete 需要 name");
        const name = String(args.name);
        const deleted = deleteRecording(name);
        return { deleted, name };
    }
    if (action === "export") {
        if (!args.name)
            throw new Error("export 需要 name");
        const name = String(args.name);
        reloadRecordingIfChanged(name);
        const entry = savedRecordings.get(name);
        if (!entry)
            throw new Error(`录制不存在: ${name}`);
        const format = String(args.format ?? "playwright");
        if (format !== "playwright") {
            throw new Error(`暂不支持的导出格式: ${format}(当前仅支持 playwright)`);
        }
        const code = compileToPlaywrightSpec(entry.steps, { title: name });
        const exportPath = typeof args.exportPath === "string" && args.exportPath ? args.exportPath : undefined;
        if (exportPath) {
            const cwd = workspaceBaseDir(config ?? {}, exec);
            const fullPath = workspaceFilePath(cwd, exportPath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, code, "utf-8");
            return { exported: true, format: "playwright", path: fullPath, code };
        }
        return { exported: true, format: "playwright", code };
    }
    throw new Error(`unknown record action: ${action}`);
}
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
export async function runReplay(steps, impls, failFast, opts = {}) {
    const results = [];
    let stoppedAt = null;
    let passed = 0;
    let healedCount = 0;
    let retryAttempted = 0;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const impl = impls[step.tool];
        if (impl === undefined) {
            results.push({ index: i, tool: step.tool, ok: false, error: `未知步骤工具: ${step.tool}` });
            if (failFast) {
                stoppedAt = i;
                break;
            }
            continue;
        }
        const hint = step.meta?.hint;
        const canHeal = opts.healing === true &&
            hint !== undefined &&
            SELECTOR_STEP_TOOLS.has(step.tool) &&
            typeof step.args?.selector === "string";
        /** 单次完整尝试(含自愈链);返回该次尝试的 result 行(带内部 healed 标记)。 */
        const attempt = async () => {
            if (!canHeal) {
                try {
                    await impl(step.args ?? {});
                    return { ok: true, result: { index: i, tool: step.tool, ok: true } };
                }
                catch (e) {
                    return { ok: false, result: { index: i, tool: step.tool, ok: false, error: e instanceof Error ? e.message : String(e) } };
                }
            }
            // 自愈路径:原选择器用较短超时先试,失败再按降级链逐个候选重试。
            const healTimeout = opts.healTimeoutMs ?? 3000;
            const quickArgs = {
                ...step.args,
                timeoutMs: Math.min(Number(step.args.timeoutMs ?? Number.POSITIVE_INFINITY) || Number.POSITIVE_INFINITY, healTimeout),
            };
            try {
                await impl(quickArgs);
                return { ok: true, result: { index: i, tool: step.tool, ok: true } };
            }
            catch (e0) {
                const tried = [];
                let healed = null;
                for (const candidate of healCandidates(hint)) {
                    tried.push(`${candidate.via}: ${candidate.selector}`);
                    try {
                        await impl({ ...step.args, selector: candidate.selector, timeoutMs: healTimeout });
                        healed = candidate;
                        break;
                    }
                    catch {
                        /* 尝试下一个候选 */
                    }
                }
                if (healed !== null) {
                    return {
                        ok: true,
                        result: { index: i, tool: step.tool, ok: true, healed: true, via: healed.via, resolved: healed.selector },
                    };
                }
                const base = e0 instanceof Error ? e0.message : String(e0);
                return {
                    ok: false,
                    result: { index: i, tool: step.tool, ok: false, error: `${base}${tried.length > 0 ? `; 自愈已尝试: ${tried.join(" | ")}` : ""}` },
                };
            }
        };
        let outcome = await attempt();
        let recovered = false;
        // F2 retryFailed:步骤失败(自愈链耗尽)后自动重试,500ms×n 线性退避;
        // 挽回则按通过计(标 recovered),重试耗尽才落到失败/failFast 停止语义。
        if (!outcome.ok && (opts.retryFailed ?? 0) > 0) {
            for (let n = 1; n <= (opts.retryFailed ?? 0); n++) {
                await sleep(500 * n);
                retryAttempted++;
                const again = await attempt();
                outcome = again;
                if (again.ok) {
                    recovered = true;
                    break;
                }
            }
        }
        if (outcome.ok) {
            passed++;
            if (outcome.result.healed === true)
                healedCount++;
            results.push(recovered ? { ...outcome.result, recovered: true } : outcome.result);
        }
        else {
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
        ...(retryAttempted > 0 ? { retries: { attempted: retryAttempted, recovered: results.filter((r) => r.recovered === true).length } } : {}),
        // null 不输出:outputSchema 中 stoppedAt 为 integer,省略比 null 兼容性更稳。
        ...(stoppedAt !== null ? { stoppedAt } : {}),
        results,
    };
}
// ---------------------------------------------------------------------------
// browser_extract:规则化抽取(CSS/attr,不含模型)+ 翻页聚合 + CSV/JSONL 落盘
// ---------------------------------------------------------------------------
/** 批处理内禁止嵌套的工具(防 batch→replay→batch 递归与录制自引用)。 */
const BATCH_FORBIDDEN = new Set(["browser_batch", "browser_replay", "browser_record"]);
/**
 * 回归报告:list 列出最近运行,show 看单条详情,
 * export 聚合生成 Markdown/HTML 报告落盘工作区。
 */
export async function reportTool(config, args, exec) {
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
        if (run === null)
            throw new Error(typeof args.runId === "string" ? `无此运行记录: ${args.runId}` : "暂无运行记录(先跑一次 browser_replay)");
        return { run };
    }
    if (action === "export") {
        const format = args.format === "html" ? "html" : "markdown";
        const source = typeof args.source === "string" && args.source !== "" ? args.source : undefined;
        const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 1000);
        const runs = listRuns(limit).filter((r) => source === undefined || r.source === source);
        if (runs.length === 0)
            throw new Error(source !== undefined ? `来源 "${source}" 暂无运行记录` : "暂无运行记录(先跑一次 browser_replay)");
        const content = format === "html" ? renderHtmlReport(runs, source) : renderMarkdownReport(runs, source);
        const cwd = workspaceBaseDir(config, exec);
        const fileArg = typeof args.file === "string" && args.file !== ""
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
export async function batchTool(args, impls, config) {
    const steps = args.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error("batch 需要非空 steps 数组:[{ tool, args }]");
    }
    const guarded = { ...impls };
    for (const name of BATCH_FORBIDDEN) {
        guarded[name] = async () => {
            throw new Error(`不允许嵌套: batch 步骤不能调用 ${name}`);
        };
    }
    const failFast = args.failFast !== false;
    const opts = {
        healing: config?.selectorHealing !== false,
        healTimeoutMs: config?.healTimeoutMs ?? 3000,
    };
    const t0 = Date.now();
    const result = await runReplay(steps, guarded, failFast, opts);
    noteRun({ kind: "batch", source: "batch", total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount, durationMs: Date.now() - t0, results: result.results });
    const stoppedAt = result.stoppedAt;
    return {
        ...result,
        summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== undefined ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈` : ""}`,
    };
}
/** 设置嵌套路径的值(路径段按 . 拆分,供 record save 的 vars 占位替换)。 */
function setPath(obj, path, value) {
    const segs = path.split(".");
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) {
        const next = cur[segs[i]];
        if (next === null || typeof next !== "object")
            throw new Error(`路径不存在: ${path}`);
        cur = next;
    }
    cur[segs[segs.length - 1]] = value;
}
/** 收集步骤中所有 {{var}} 占位符名(导出供测试)。 */
export function findPlaceholders(steps) {
    const found = new Set();
    const walk = (v) => {
        if (typeof v === "string") {
            for (const m of v.matchAll(/\{\{([\w-]+)\}\}/g))
                found.add(m[1]);
        }
        else if (Array.isArray(v)) {
            v.forEach(walk);
        }
        else if (v !== null && typeof v === "object") {
            Object.values(v).forEach(walk);
        }
    };
    steps.forEach((s) => walk(s.args));
    return [...found];
}
/**
 * 深拷贝步骤并替换字符串叶子里的 {{var}} 占位符(导出供测试)。
 * vars 缺失的占位符保留原样(由调用方先 findPlaceholders 校验)。
 */
export function substituteVars(steps, vars) {
    const walk = (v) => {
        if (typeof v === "string") {
            return v.replace(/\{\{([\w-]+)\}\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
        }
        if (Array.isArray(v))
            return v.map(walk);
        if (v !== null && typeof v === "object") {
            const out = {};
            for (const [k, val] of Object.entries(v))
                out[k] = walk(val);
            return out;
        }
        return v;
    };
    return steps.map((s) => ({ ...s, args: walk(s.args) }));
}
/** 运行结果落一条运行记录(runs.jsonl);失败静默,不阻断主流程。 */
function noteRun(record) {
    try {
        const ts = Date.now();
        appendRun({ runId: makeRunId(ts), ts, ...record });
    }
    catch {
        /* 报告写入失败不影响回放 */
    }
}
/**
 * 回放入口:name(已保存录制)或 steps(数组)二选一。
 * vars 注入 {{占位符}};data/dataFile 数据集模式逐行运行并聚合。
 */
export async function replayTool(args, impls, config, exec) {
    let steps = [];
    let source = "steps";
    if (typeof args.name === "string" && args.name) {
        // 磁盘热重载:录制文件被手改后不必等新会话,mtime 较新则先重载再回放。
        const reloaded = reloadRecordingIfChanged(args.name);
        const saved = savedRecordings.get(args.name);
        if (saved === undefined)
            throw new Error(`未找到录制: ${args.name}`);
        steps = saved.steps;
        source = args.name;
        if (reloaded)
            source = `${args.name}(已从磁盘重载)`;
    }
    else if (Array.isArray(args.steps)) {
        steps = args.steps;
    }
    else {
        throw new Error("replay 需要 name(已保存录制)或 steps(步骤数组)");
    }
    if (steps.length === 0)
        throw new Error("步骤为空");
    const failFast = args.failFast !== false;
    // F2 retryFailed:失败步骤自动重试次数(0-10;500ms×n 线性退避,重试耗尽才停)。
    const retryFailed = Math.min(Math.max(Math.floor(Number(args.retryFailed ?? 0)) || 0, 0), 10);
    // retryOf:面板一键重跑传入,标记本运行重跑自哪次 run(仅记录用)。
    const retryOf = typeof args.retryOf === "string" && args.retryOf !== "" ? args.retryOf : undefined;
    const runMeta = {
        ...(retryFailed > 0 || retryOf !== undefined
            ? { ...(retryFailed > 0 ? { retries: { attempted: 0, recovered: 0 } } : {}), ...(retryOf !== undefined ? { retryOf } : {}) }
            : {}),
    };
    const opts = {
        healing: config?.selectorHealing !== false,
        healTimeoutMs: config?.healTimeoutMs ?? 3000,
        ...(retryFailed > 0 ? { retryFailed } : {}),
    };
    // 数据集模式:data 数组或 dataFile(CSV,首行为变量名),逐行运行。
    let rows = null;
    if (Array.isArray(args.data)) {
        rows = args.data;
    }
    else if (typeof args.dataFile === "string" && args.dataFile !== "") {
        const cwd = workspaceBaseDir(config ?? {}, exec);
        const file = workspaceFilePath(cwd, args.dataFile);
        if (!existsSync(file))
            throw new Error(`dataFile 不存在: ${file}`);
        rows = parseCsv(readFileSync(file, "utf8"));
    }
    if (rows !== null) {
        if (rows.length === 0)
            throw new Error("数据集为空(0 行)");
        const placeholders = findPlaceholders(steps);
        const runs = [];
        let okRows = 0;
        for (let i = 0; i < rows.length; i++) {
            const rowVars = { ...args.vars, ...rows[i] };
            const missing = placeholders.filter((p) => !(p in rowVars));
            const t0 = Date.now();
            if (missing.length > 0) {
                runs.push({ row: i, total: steps.length, passed: 0, failed: steps.length, healedCount: 0, results: [], error: `缺少变量: ${missing.join(", ")}` });
                noteRun({ kind: "replay", source, total: steps.length, passed: 0, failed: steps.length, healedCount: 0, durationMs: Date.now() - t0, row: i, results: [], ...runMeta });
                continue;
            }
            const result = await runReplay(substituteVars(steps, rowVars), impls, failFast, opts);
            const stoppedAt = result.stoppedAt;
            runs.push({ row: i, ...result });
            if (result.failed === 0)
                okRows++;
            noteRun({ kind: "replay", source, total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount, durationMs: Date.now() - t0, row: i, results: result.results, ...(result.retries ?? runMeta.retries), ...runMeta.retryOf !== undefined ? { retryOf: runMeta.retryOf } : {} });
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
    const vars = args.vars ?? {};
    const missing = findPlaceholders(steps).filter((p) => !(p in vars));
    if (missing.length > 0) {
        throw new Error(`缺少变量: ${missing.join(", ")}(录制含 {{占位符}},请用 vars 提供)`);
    }
    const t0 = Date.now();
    const result = await runReplay(substituteVars(steps, vars), impls, failFast, opts);
    const stoppedAt = result.stoppedAt;
    const retries = result.retries;
    noteRun({
        kind: "replay", source, total: result.total, passed: result.passed, failed: result.failed, healedCount: result.healedCount,
        durationMs: Date.now() - t0, results: result.results,
        ...(retries !== undefined ? { retries } : {}),
        ...(retryOf !== undefined ? { retryOf } : {}),
    });
    return {
        source,
        ...result,
        summary: `${result.passed}/${result.total} 通过${result.failed > 0 ? `, ${result.failed} 失败${stoppedAt !== undefined ? `(停在步骤 ${stoppedAt})` : ""}` : ""}${result.healedCount > 0 ? `,${result.healedCount} 步自愈(建议修复录制选择器)` : ""}${retries !== undefined && retries.recovered > 0 ? `,重试挽回 ${retries.recovered}/${retries.attempted}` : ""}`,
    };
}
let rerunHandler = null;
let rerunInFlight = false;
/** registerTools 注册重跑入口(stepImpls 同路径);web-only 进程保持 null。 */
export function setRerunHandler(fn) {
    rerunHandler = fn;
}
/** 当前可用的重跑入口(null = 本进程没有 tools 服务,无法重跑)。 */
export function getRerunHandler() {
    return rerunHandler;
}
/** 重跑是否正在执行(端点互斥;导出供测试)。 */
export function rerunBusy() {
    return rerunInFlight;
}
/** 执行一次面板重跑(busy 检查 + 互斥标记;返回 replayTool 结果)。 */
export async function runPanelRerun(req) {
    if (rerunInFlight)
        throw Object.assign(new Error("重跑进行中"), { status: 409 });
    rerunInFlight = true;
    try {
        const handler = rerunHandler;
        if (handler === null)
            throw Object.assign(new Error("本进程无回放能力(tools 服务未注册)"), { status: 503 });
        return await handler(req);
    }
    finally {
        rerunInFlight = false;
    }
}
//# sourceMappingURL=recorder.js.map