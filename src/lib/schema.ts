// dsh-browser · 配置 Schema 与默认值(单一来源)
//
// DSH 插件入口(src/index.ts)与独立 MCP 入口(src/mcp.ts)共用:
// 配置键集合、类型约束、默认值只在这一处维护(消费方映射见 DocMind 09)。

import type { ConfigSchema } from "./config.js";

export const BROWSER_CONFIG_SCHEMA: ConfigSchema = {
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
  snapshotHistory: { type: "number", min: 1, max: 20 },
  confirmMode: { type: "string", enum: ["off", "manual", "auto"] },
  confirmTimeoutMs: { type: "number", min: 1000 },
  sensitivePatterns: { type: "string[]" },
  sensitiveTools: { type: "string[]" },
  confirmPolicies: { type: "any", optional: true },
  humanize: { type: "any", optional: true },
  humanizeSpeed: { type: "string", enum: ["slow", "normal", "fast"], optional: true },
  confirmInReplay: { type: "boolean" },
  somFallback: { type: "boolean" },
  refReanchor: { type: "boolean" },
  toolset: { type: "string", enum: ["core", "all"] },
};

export const BROWSER_DEFAULT_CONFIG = {
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
  snapshotHistory: 5, // 增量快照保留的历史版本数 K(1-20;≈20KB/版本 → ≤100KB/page)
  confirmMode: "off", // off: 不主动拦截 | manual: systemPrompt 指示 | auto: 宿主层硬拦截(提交/删除/支付类)
  confirmTimeoutMs: 60000,
  sensitivePatterns: ["提交", "删除", "支付"], // auto 模式敏感文本模式(子串匹配,命中任一即拦)
  sensitiveTools: ["browser_click"], // auto 模式参与判定的工具(默认只拦 click)
  confirmInReplay: true, // replay/batch 是否同样走 auto 审批闸
  somFallback: true, // what 语义定位零命中时自动附 SoM 标徽截图(多模态看图后 click { mark: N })
  refReanchor: true, // SPA 路由导航后 ref 软失效重锚定(按 role+name 指纹;false = 导航即清空的旧行为)
  toolset: "all", // all: 全部工具(默认);core: 只注册高频核心集,低 systemPrompt 常驻 token
};
