// dsh-browser · 浏览器 — 实时画面数据 API(/status /screenshot /history)
//
// 供原生嵌入面板与实时画面模态框轮询的同源数据端点:状态、实时截图(2 秒
// 轮询)、访问历史。点面板缩略图弹出大屏模态框,内含实时画面与访问历史。
import { activePage, historyOf, currentProfile, testLogOf } from "./session.js";
import { statusTool } from "./tools.js";
import { listRecordings, recordingDetail, deleteRecording } from "./recordings.js";
import { urlPath, sendText, sendJson, readJsonBody } from "../lib/http.js";
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
                sendJson(res, 200, state);
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
                sendJson(res, 200, {
                    profile: currentProfile,
                    calls: testLogOf().slice(0, 50),
                });
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