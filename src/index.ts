// dsh-browser · 插件入口
//
// 一个插件行提供两件事:
//   1. 共享 Playwright 浏览器自动化:22 个 browser_* 工具(agent 调用);
//   2. 原生界面实时画面面板:webServer.tapIndex 注入右下角悬浮面板,
//      状态行 + 缩略图,点开大屏模态框(2 秒轮询实时画面 + 访问历史)。
//
// 零 @deepseek-ai 运行时依赖:通过 cordis 上下文字符串键鸭子类型访问
// tools / systemPrompt / webServer,最大版本宽容度。

import type { ReefContext } from "./lib/types.js";
import { resolveConfig, type ConfigSchema } from "./lib/config.js";
import { sendJson } from "./lib/http.js";
import { registerTools } from "./browser/register.js";
import { registerBrowserApi } from "./browser/ui.js";
import { closeBrowser, sweepScreenshotDir } from "./browser/session.js";
import { loadRecordings } from "./browser/recordings.js";
import type { BrowserConfig } from "./browser/types.js";
import { applyEmbed } from "./embed.js";

export const name = "dsh-browser";
export const inject = ["tools", "webServer"];

const SCHEMA: ConfigSchema = {
  enabled: { type: "boolean", optional: true },
  channel: { type: "string" },
  executablePath: { type: "string" },
  headless: { type: "boolean" },
  userDataDir: { type: "string" },
  profiles: { type: "any" },
  screenshotDir: { type: "string" },
  downloadDir: { type: "string" },
  screenshotMaxAgeDays: { type: "number", min: 0 },
  screenshotMaxCount: { type: "number", min: 0 },
  basePath: { type: "string" },
  recordBodies: { type: "boolean" },
  maxTextChars: { type: "number", min: 1 },
  maxLinks: { type: "number", min: 1 },
  timeoutMs: { type: "number", min: 1 },
};

const DEFAULT_CONFIG = {
  channel: "auto", // 'auto' | 'msedge' | 'chrome' | 'chromium' | '' (playwright 默认)
  executablePath: "",
  headless: false, // 本机调试默认有头(人工登录友好);服务器场景可显式覆盖为 true
  userDataDir: "",
  profiles: {},
  screenshotDir: ".dsh-browser/screenshots",
  downloadDir: ".dsh-browser/downloads",
  screenshotMaxAgeDays: 7,
  screenshotMaxCount: 200,
  basePath: "/browser",
  recordBodies: true,
  maxTextChars: 20000,
  maxLinks: 50,
  timeoutMs: 30000,
};

export function apply(ctx: ReefContext, rawConfig: Record<string, any>) {
  const resolved = resolveConfig("dsh-browser", SCHEMA, DEFAULT_CONFIG, rawConfig);
  if (resolved.enabled === false) return;
  const config = resolved as BrowserConfig;
  const base = (config.basePath ?? "/browser").replace(/\/+$/, "");

  // 0) 加载磁盘上的录制(持久化回归资产)。
  const loadedRecordings = loadRecordings();
  if (loadedRecordings > 0) {
    ctx.logger?.info?.(`dsh-browser: loaded ${loadedRecordings} saved recording(s)`);
  }

  // 1) 注册 browser_* 工具(仅当 tools 服务存在;不存在则插件静默跳过)。
  registerTools(ctx, config);
  const systemPrompt = ctx.get<{
    section(section: { name: string; order?: number; text: string }): () => void;
  }>("systemPrompt");
  const sectionDispose = systemPrompt?.section?.({
    name: "tool:browser",
    order: 200,
    text: "浏览器工具操作一个共享浏览器会话,支持多标签页与多配置文件。打开页面后先用 browser_snapshot 读文本与链接、browser_elements 读表单结构,再决定 browser_click / browser_type / browser_form;标签管理用 browser_tabs;下载用 browser_download;登录态用 browser_cookies。做自动化测试时:用 browser_wait_for 显式等待页面稳定/元素出现,用 browser_assert 断言(失败自动截图),用 browser_network 检查接口调用与 4xx/5xx,跑完一轮可用 browser_record save 保存操作序列、browser_replay 回放做回归。遇到需要登录的网站:先 browser_open 打开登录页,告知用户请在浏览器窗口中完成登录,再调用 browser_wait_for_login 等待(可给 successSelector/successUrl);配置 userDataDir 时登录态会持久化。用户可通过界面右下角面板的实时画面查看浏览器。",
  });
  if (sectionDispose !== undefined) ctx.effect(() => sectionDispose);

  // 2) 实时画面数据 API(/status /screenshot /history)。
  registerBrowserApi(ctx, config, base);

  // 3) 原生面板嵌入(tapIndex 注入)。
  const webServer = ctx.get<{
    register(route: import("./lib/types.js").WebRoute): () => void;
    tapIndex(transform: (html: string) => string): () => void;
    port?: number;
  }>("webServer");
  if (webServer !== undefined) {
    applyEmbed(ctx, webServer, base);
    // client 半的服务发现:返回面板/API 基路径(client 用它拼录制管理端点)。
    const disposeConfig = webServer.register({
      kind: "exact",
      path: "/__dsh-browser__/config",
      handler: (_req, res) => {
        sendJson(res, 200, { basePath: base });
      },
    });
    ctx.effect(() => () => {
      try {
        disposeConfig();
      } catch {
        /* ignore */
      }
    });
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
