// dsh-browser · 浏览器 — 实时画面数据 API(/status /screenshot /history)
//
// 供原生嵌入面板与实时画面模态框轮询的同源数据端点:状态、实时截图(2 秒
// 轮询)、访问历史。点面板缩略图弹出大屏模态框,内含实时画面与访问历史。

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReefContext, WebRoute } from "../lib/types.js";
import type { BrowserConfig } from "./types.js";
import { activePage, historyOf, currentProfile, testLogOf, currentPause, getPendingConfirm, resolveConfirm } from "./session.js";
import { statusTool } from "./tools.js";
import { listRecordings, recordingDetail, deleteRecording } from "./recordings.js";
import { latestRun, listRuns, renderHtmlReport } from "./reports.js";
import { urlPath, sendText, sendJson, readJsonBody } from "../lib/http.js";

/** 展示层参数截断:单字段 JSON 超过 300 字符截断(仅用于面板轨迹显示,不进录制)。 */
function truncateForDisplay(args: unknown): unknown {
  if (typeof args !== "object" || args === null) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const s = JSON.stringify(v);
    out[k] = s && s.length > 300 ? `${s.slice(0, 300)}…(截断)` : v;
  }
  return out;
}


export function registerBrowserApi(ctx: ReefContext, config: BrowserConfig, base: string) {
  const webServer = ctx.get<{ register(route: WebRoute): () => void }>("webServer");
  if (webServer === undefined) return;
  const disposers: (() => void)[] = [];
  disposers.push(
    webServer.register({
      kind: "prefix",
      path: base,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
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
        if (path === `${base}/runs/latest`) {
          // 最近一次回归运行(replay/batch),供面板「最近回归」行展示。
          sendJson(res, 200, { run: latestRun() });
          return;
        }
        if (path === `${base}/runs/report`) {
          // 面板内嵌 HTML 报告:?source=xxx 过滤指定录制,默认取最近一次运行的来源。
          let source = "";
          try {
            source = new URL(req.url ?? "/", "http://x").searchParams.get("source") ?? "";
          } catch {
            /* ignore */
          }
          if (source === "") source = latestRun()?.source ?? "";
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
            const body = (await readJsonBody(req).catch(() => undefined)) as { name?: unknown } | undefined;
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
          } catch {
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
            const body = (await readJsonBody(req).catch(() => undefined)) as
              | { id?: unknown; decision?: unknown }
              | undefined;
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
          } catch (error) {
            sendText(res, 500, `screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          return;
        }
        sendText(res, 404, "not found");
      },
    }),
  );
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  });
}
