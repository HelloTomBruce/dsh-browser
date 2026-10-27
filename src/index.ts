// dsh-browser · 插件入口
//
// 一个插件行提供两件事:
//   1. 共享 Playwright 浏览器自动化:22 个 browser_* 工具(agent 调用);
//   2. 原生界面实时画面面板:client 插件注入右下角悬浮面板与设置项,
//      状态行 + 缩略图,点开大屏模态框(2 秒轮询实时画面 + 访问历史)。
//
// 零 @deepseek-ai 运行时依赖:通过 cordis 上下文字符串键鸭子类型访问
// tools / systemPrompt / webServer,最大版本宽容度。

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReefContext } from "./lib/types.js";
import { resolveConfig } from "./lib/config.js";
import { BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG } from "./lib/schema.js";
import { browserSystemPrompt } from "./lib/prompts.js";
import { sendJson } from "./lib/http.js";
import { registerTools } from "./browser/register.js";
import { registerBrowserApi } from "./browser/ui.js";
import { setDoctorProbe } from "./browser/tools.js";
import { closeBrowser, sweepScreenshotDir } from "./browser/session.js";
import { loadRecordings } from "./browser/recordings.js";
import type { BrowserConfig } from "./browser/types.js";

export const name = "dsh-browser-view";
// 不声明任何硬性 inject:本插件的两个消费面分布在不同进程——
// web 宿主进程有 webServer(右下角面板 + /browser/* 路由)但没有 tools,
// agent 会话进程有 tools(browser_* 工具)但没有 webServer。此 cordis 分支
// 的 inject 为硬性要求,任一服务缺失整个 fiber 保持 INACTIVE,apply 永不
// 执行。apply 内部已对 ctx.get() 逐一做 undefined 防御,哪个服务存在就
// 注册哪一半,因此这里留空即可在两种进程中各取所需。
export const inject: string[] = [];

export function apply(ctx: ReefContext, rawConfig: Record<string, any>) {
  const resolved = resolveConfig("dsh-browser-view", BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG, rawConfig);
  if (resolved.enabled === false) return;
  const config = resolved as BrowserConfig;
  const base = (config.basePath ?? "/browser").replace(/\/+$/, "");

  // 0) 加载磁盘上的录制(持久化回归资产)。
  const loadedRecordings = loadRecordings();
  if (loadedRecordings > 0) {
    ctx.logger?.info?.(`dsh-browser-view: loaded ${loadedRecordings} saved recording(s)`);
  }

  // 1) 注册 browser_* 工具(当 tools 服务存在/就绪时绑定)。
  const bindTools = (toolCtx: ReefContext) => {
    registerTools(toolCtx, config);
  };
  if (typeof ctx.inject === "function") {
    ctx.inject(["tools"], (toolCtx) => {
      bindTools(toolCtx);
    });
  } else {
    bindTools(ctx);
  }

  const bindPrompt = (promptCtx: ReefContext) => {
    const systemPrompt =
      promptCtx.get<{
        section(section: { name: string; order?: number; text: string }): () => void;
      }>("systemPrompt") ?? (promptCtx as any).systemPrompt;
    if (systemPrompt === undefined) return;
    const toolPrompt = browserSystemPrompt(config);
    const sectionDispose = systemPrompt?.section?.({
      name: "tool:browser",
      order: 200,
      text: toolPrompt,
    });
    if (sectionDispose !== undefined) promptCtx.effect(() => sectionDispose);
  };
  if (typeof ctx.inject === "function") {
    ctx.inject(["systemPrompt"], (promptCtx) => {
      bindPrompt(promptCtx);
    });
  } else {
    bindPrompt(ctx);
  }

  // 2) 实时画面数据 API 与自检探针 (当 webServer 服务存在/就绪时响应式绑定)。
  const bindWebServer = (webCtx: ReefContext) => {
    registerBrowserApi(webCtx, config, base);
    const webServer =
      webCtx.get<{
        register(route: import("./lib/types.js").WebRoute): () => void;
        port?: number;
      }>("webServer") ?? (webCtx as any).webServer;
    if (webServer !== undefined) {
      // browser_doctor 面板自检探针:fetch 本机 /status(webServer 有 port 时)。
      const port = webServer.port;
      setDoctorProbe(
        port !== undefined
          ? async (basePath) => {
              try {
                const res = await fetch(`http://127.0.0.1:${port}${basePath}/status`, {
                  signal: AbortSignal.timeout(2_000),
                  cache: "no-store",
                });
                return res.ok
                  ? { ok: true, detail: `面板 API 可达(/status → 200,端口 ${port})` }
                  : { ok: false, detail: `面板 API 异常(/status → ${res.status})`, advice: "查看 DSH 日志中 webServer 的注册错误" };
              } catch (e) {
                return {
                  ok: false,
                  detail: `本机 127.0.0.1:${port} 请求失败: ${e instanceof Error ? e.message : String(e)}`,
                  advice: "确认 DSH web 端口未被防火墙/代理拦截",
                };
              }
            }
          : null,
      );
      // client 半的服务发现:返回面板/API 基路径(client 用它拼录制管理端点)。
      const disposeConfig = webServer.register({
        kind: "exact",
        path: "/__dsh-browser-view__/config",
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          sendJson(res, 200, { basePath: base });
        },
      });
      webCtx.effect(() => () => {
        try {
          disposeConfig();
        } catch {
          /* ignore */
        }
      });
    }
  };

  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (webCtx) => {
      bindWebServer(webCtx);
    });
  } else if (ctx.get("webServer") !== undefined || (ctx as any).webServer !== undefined) {
    bindWebServer(ctx);
  }

  // 4) 截图目录定时清扫:每小时一次(懒清理在每次截图后已即时执行)。
  const sweepTimer = setInterval(() => {
    try {
      sweepScreenshotDir({
        maxAgeDays: config.screenshotMaxAgeDays,
        maxCount: config.screenshotMaxCount,
      });
    } catch {
      /* ignore */
    }
  }, 60 * 60 * 1000);
  sweepTimer.unref?.();

  // 5) 插件卸载时清理浏览器会话与定时器。
  ctx.effect(() => () => {
    clearInterval(sweepTimer);
    void closeBrowser().catch(() => {});
  });
}
