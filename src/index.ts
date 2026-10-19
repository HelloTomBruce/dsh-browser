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

export const name = "dsh-browser-view";
// 不声明任何硬性 inject:本插件的两个消费面分布在不同进程——
// web 宿主进程有 webServer(右下角面板 + /browser/* 路由)但没有 tools,
// agent 会话进程有 tools(browser_* 工具)但没有 webServer。此 cordis 分支
// 的 inject 为硬性要求,任一服务缺失整个 fiber 保持 INACTIVE,apply 永不
// 执行。apply 内部已对 ctx.get() 逐一做 undefined 防御,哪个服务存在就
// 注册哪一半,因此这里留空即可在两种进程中各取所需。
export const inject: string[] = [];

const SCHEMA: ConfigSchema = {
  enabled: { type: "boolean", optional: true },
  channel: { type: "string" },
  executablePath: { type: "string" },
  headless: { type: "boolean" },
  userDataDir: { type: "string" },
  profiles: { type: "any" },
  screenshotDir: { type: "string" },
  downloadDir: { type: "string" },
  workspaceDir: { type: "string" },
  screenshotMaxAgeDays: { type: "number", min: 0 },
  screenshotMaxCount: { type: "number", min: 0 },
  basePath: { type: "string" },
  recordBodies: { type: "boolean" },
  maxTextChars: { type: "number", min: 1 },
  maxLinks: { type: "number", min: 1 },
  timeoutMs: { type: "number", min: 1 },
  baselineDir: { type: "string" },
  selectorHealing: { type: "boolean" },
  healTimeoutMs: { type: "number", min: 100 },
  maxRefs: { type: "number", min: 1 },
  maxRows: { type: "number", min: 1 },
};

const DEFAULT_CONFIG = {
  channel: "auto", // 'auto' | 'msedge' | 'chrome' | 'chromium' | '' (playwright 默认)
  executablePath: "",
  headless: false, // 本机调试默认有头(人工登录友好);服务器场景可显式覆盖为 true
  userDataDir: "",
  profiles: {},
  screenshotDir: ".dsh-browser/screenshots",
  downloadDir: ".dsh-browser/downloads",
  workspaceDir: "",
  screenshotMaxAgeDays: 7,
  screenshotMaxCount: 200,
  basePath: "/browser",
  recordBodies: true,
  maxTextChars: 20000,
  maxLinks: 50,
  timeoutMs: 30000,
  baselineDir: ".dsh-browser/baselines",
  selectorHealing: true,
  healTimeoutMs: 3000,
  maxRefs: 200,
  maxRows: 1000,
};

export function apply(ctx: ReefContext, rawConfig: Record<string, any>) {
  const resolved = resolveConfig("dsh-browser-view", SCHEMA, DEFAULT_CONFIG, rawConfig);
  if (resolved.enabled === false) return;
  const config = resolved as BrowserConfig;
  const base = (config.basePath ?? "/browser").replace(/\/+$/, "");

  // 0) 加载磁盘上的录制(持久化回归资产)。
  const loadedRecordings = loadRecordings();
  if (loadedRecordings > 0) {
    ctx.logger?.info?.(`dsh-browser-view: loaded ${loadedRecordings} saved recording(s)`);
  }

  // 1) 注册 browser_* 工具(仅当 tools 服务存在;不存在则插件静默跳过)。
  registerTools(ctx, config);
  const systemPrompt = ctx.get<{
    section(section: { name: string; order?: number; text: string }): () => void;
  }>("systemPrompt");
  const sectionDispose = systemPrompt?.section?.({
    name: "tool:browser",
    order: 200,
    text: "浏览器工具操作一个共享浏览器会话,支持多标签页与多配置文件。打开页面后先用 browser_snapshot 读文本与链接、browser_elements 读表单结构(含关联 label 与展开的下拉选项),再决定 browser_click / browser_type / browser_form;定位操作元素优先用 browser_snapshot { mode: \"aria\" }(可交互元素带 ref=eN,click/type/select/press 直接传 ref 代替 CSS 选择器);下拉选择(原生 select 与 antd/element 组件库)用 browser_select 传 selector/ref + option 文本一步完成;固定小序列(点击→等待→输入→提交)用 browser_batch 一次执行减少往返;标签管理用 browser_tabs;下载用 browser_download(wait=true 可等新下载);登录态用 browser_cookies。做自动化测试时:用 browser_wait_for 显式等待页面稳定/元素出现,用 browser_assert 断言(失败自动截图;visual={baseline} 可做视觉回归,先用 browser_screenshot { baseline } 建基线),用 browser_network 检查接口调用与 4xx/5xx,跑完一轮可用 browser_record save 保存操作序列、browser_replay 回放做回归(选择器失效自动按指纹自愈;vars/data 支持参数化与数据驱动)。每次 replay/batch 都记入运行历史,browser_report list/export 可查看与导出回归报告。抓取结构化数据用 browser_extract(fields 定义 CSS 字段,可翻页,可导出 CSV/JSONL)。遇到需要登录的网站:先 browser_open 打开登录页,告知用户请在浏览器窗口中完成登录,再调用 browser_wait_for_login 等待(可给 successSelector/successUrl);配置 userDataDir 时登录态会持久化。用户可通过界面右下角面板的实时画面查看浏览器。",
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
      path: "/__dsh-browser-view__/config",
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
