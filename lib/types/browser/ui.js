// dsh-browser · 浏览器 — 实时画面数据 API(/status /screenshot /history)
//
// 供原生嵌入面板与实时画面模态框轮询的同源数据端点:状态、实时截图(2 秒
// 轮询)、访问历史。点面板缩略图弹出大屏模态框,内含实时画面与访问历史。
import { activePage, historyOf, currentProfile, testLogOf, currentPause, getPendingConfirm, resolveConfirm, activeToolCalls } from "./session.js";
import { screencastManager } from "./session/screencast.js";
import { sessionTracer } from "./session/tracer.js";
import { statusTool, runPanelRerun, getRerunHandler, rerunBusy } from "./tools.js";
import { listRecordings, recordingDetail, deleteRecording } from "./recordings.js";
import { latestRun, listRuns, renderHtmlReport } from "./reports.js";
import { urlPath, sendText, sendJson, readJsonBody } from "../lib/http.js";
/** 展示层参数截断:单字段 JSON 超过 300 字符截断(仅用于面板轨迹显示,不进录制)。 */
function truncateForDisplay(args) {
    if (typeof args !== "object" || args === null)
        return args;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        const s = JSON.stringify(v);
        out[k] = s && s.length > 300 ? `${s.slice(0, 300)}…(截断)` : v;
    }
    return out;
}
export function registerBrowserApi(ctx, config, base) {
    const webServer = ctx.get("webServer");
    if (webServer === undefined)
        return;
    const disposers = [];
    disposers.push(webServer.register({
        kind: "prefix",
        path: base,
        handler: async (req, res) => {
            const path = urlPath(req);
            if (path === `${base}/status`) {
                const state = await statusTool();
                // 附带人工接管等待状态(等待期间面板展示提示语)。
                sendJson(res, 200, { ...state, pause: currentPause() });
                return;
            }
            if (path === `${base}/history`) {
                // 访问历史:按时间倒序,最新在前。
                sendJson(res, 200, {
                    profile: currentProfile,
                    history: [...historyOf(currentProfile)].reverse(),
                });
                return;
            }
            if (path === `${base}/log`) {
                // 操作轨迹:最近 50 次工具调用,按时间倒序。
                // 展示层截断大字段(script/steps 等超 300 字符截断);
                // 完整 args 保存在录制数据源里,回放不受影响。
                sendJson(res, 200, {
                    profile: currentProfile,
                    calls: testLogOf().slice(0, 50).map((c) => ({ ...c, args: truncateForDisplay(c.args) })),
                });
                return;
            }
            if (path === `${base}/timeline`) {
                // F4 全景时光机: 单步时间轴、Console 日志与网络失败链路
                sendJson(res, 200, {
                    profile: currentProfile,
                    traces: sessionTracer.getTraces(currentProfile),
                });
                return;
            }
            if (path === `${base}/runs/latest`) {
                // 最近一次回归运行(replay/batch),供面板「最近回归」行展示;
                // busy = agent 有工具调用在途或重跑在执行(面板据此置灰重跑按钮)。
                sendJson(res, 200, { run: latestRun(), busy: activeToolCalls() > 0 || rerunBusy() });
                return;
            }
            if (path === `${base}/runs/rerun`) {
                // F2 面板一键重跑:body { source, retryOf? }。与 browser_replay 同路径
                // (replayTool + stepImpls,含 auto 审批闸);agent 忙碌 409(面板置灰依据)。
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
                const body = (await readJsonBody(req).catch(() => undefined));
                const source = typeof body?.source === "string" ? body.source.trim() : "";
                if (!source) {
                    sendJson(res, 400, "source required");
                    return;
                }
                try {
                    const result = await runPanelRerun({
                        source,
                        ...(typeof body?.retryOf === "string" && body.retryOf !== "" ? { retryOf: body.retryOf } : {}),
                    });
                    sendJson(res, 200, { ok: true, result });
                }
                catch (e) {
                    sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
                }
                return;
            }
            if (path === `${base}/runs/report`) {
                // 面板内嵌 HTML 报告:?source=xxx 过滤指定录制,默认取最近一次运行的来源。
                let source = "";
                try {
                    source = new URL(req.url ?? "/", "http://x").searchParams.get("source") ?? "";
                }
                catch {
                    /* ignore */
                }
                if (source === "")
                    source = latestRun()?.source ?? "";
                const runs = listRuns(50).filter((r) => (source === "" ? true : r.source === source));
                const html = renderHtmlReport(runs, source === "" ? undefined : source);
                res.writeHead(200, {
                    "content-type": "text/html; charset=utf-8",
                    "cache-control": "no-store",
                    "content-length": Buffer.byteLength(html),
                });
                res.end(html);
                return;
            }
            if (path === `${base}/recordings`) {
                if ((req.method ?? "GET") === "POST") {
                    // 删除录制:body { name }
                    const body = (await readJsonBody(req).catch(() => undefined));
                    const name = typeof body?.name === "string" ? body.name : "";
                    if (!name) {
                        sendText(res, 400, "name required");
                        return;
                    }
                    sendJson(res, 200, { deleted: deleteRecording(name), name });
                    return;
                }
                sendJson(res, 200, { recordings: listRecordings() });
                return;
            }
            if (path === `${base}/recordings/detail`) {
                // 录制步骤详情:?name=xxx
                let name = "";
                try {
                    name = new URL(req.url ?? "/", "http://x").searchParams.get("name") ?? "";
                }
                catch {
                    /* ignore */
                }
                const detail = recordingDetail(name);
                if (detail === undefined) {
                    sendText(res, 404, `no recording ${name}`);
                    return;
                }
                sendJson(res, 200, detail);
                return;
            }
            if (path === `${base}/confirm`) {
                if ((req.method ?? "GET") === "POST") {
                    // 提交审批决策:body { id, decision: "allowed" | "denied" }
                    const body = (await readJsonBody(req).catch(() => undefined));
                    const id = typeof body?.id === "string" ? body.id : "";
                    const decision = body?.decision === "allowed" || body?.decision === "denied" ? body.decision : undefined;
                    if (!id || decision === undefined) {
                        sendText(res, 400, "id and decision (allowed|denied) required");
                        return;
                    }
                    sendJson(res, 200, { resolved: resolveConfirm(id, decision), id, decision });
                    return;
                }
                // 当前待审批请求(等待期间面板展示允许/拒绝按钮)。
                sendJson(res, 200, { confirm: getPendingConfirm() });
                return;
            }
            if (path === `${base}/stream`) {
                const page = activePage();
                if (page === null || page.isClosed()) {
                    sendText(res, 404, "browser not open");
                    return;
                }
                const accept = req.headers.accept || "";
                const isSSE = accept.includes("text/event-stream") || Boolean(req.url?.includes("sse=1"));
                if (isSSE) {
                    res.writeHead(200, {
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache, no-transform",
                        connection: "keep-alive",
                        "x-accel-buffering": "no",
                    });
                    res.write("retry: 1000\n\n");
                    const unsubscribe = screencastManager.subscribe((frame) => {
                        try {
                            res.write(`data: ${JSON.stringify({ frame: frame.base64, metadata: frame.metadata, timestamp: frame.timestamp })}\n\n`);
                        }
                        catch {
                            /* closed */
                        }
                    });
                    req.on("close", () => {
                        unsubscribe();
                    });
                    return;
                }
                // Default: multipart/x-mixed-replace (MJPEG 流)
                res.writeHead(200, {
                    "content-type": "multipart/x-mixed-replace; boundary=--frame",
                    "cache-control": "no-cache, no-transform",
                    connection: "keep-alive",
                    "x-accel-buffering": "no",
                });
                const unsubscribe = screencastManager.subscribe((frame) => {
                    try {
                        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`);
                        res.write(frame.buffer);
                        res.write("\r\n");
                    }
                    catch {
                        /* closed */
                    }
                });
                req.on("close", () => {
                    unsubscribe();
                });
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
                        "content-length": buffer.length,
                    });
                    res.end(buffer);
                }
                catch (error) {
                    sendText(res, 500, `screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
                }
                return;
            }
            sendText(res, 404, "not found");
        },
    }));
    ctx.effect(() => () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                /* ignore */
            }
        }
    });
}
//# sourceMappingURL=ui.js.map