// dsh-browser · 浏览器工具定义 — navigation
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import {
  openTool, backTool, reloadTool, statusTool, closeTool,
  tabsTool, profileTool, contextTool,
} from "../tools.js";

export function getNavigationTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_open",
      description:
        "在共享浏览器中打开一个 URL。之后可用 browser_snapshot 读取页面内容,用 browser_click / browser_type / browser_eval 操作页面,用 browser_screenshot 截图。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要打开的完整 URL(含协议)。" },
          waitUntil: {
            type: "string",
            enum: ["load", "domcontentloaded", "commit"],
            description: "等待策略,默认 domcontentloaded。",
          },
          timeoutMs: { type: "integer", description: "等待超时(毫秒)。" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          status: { type: "string" },
        },
        required: ["url", "title", "status"],
      },
      render: (_args, value) => `Opened ${value.url}\nTitle: ${value.title}`,
      presentCall: (args) => genericCard("browser", String(args.url), String(args.url)),
      timeoutMs: timeout(),
      execute: (args) => openTool(config, args),
    }),
    definePlainTool({
      name: "browser_back",
      description: "返回上一页(如无历史则无操作)。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { url: { type: "string" }, title: { type: "string" } },
        required: ["url", "title"],
      },
      render: (_args, value) => `Back to: ${value.url}`,
      timeoutMs: timeout(),
      execute: () => backTool(config),
    }),
    definePlainTool({
      name: "browser_reload",
      description: "重新加载当前页面。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { url: { type: "string" }, title: { type: "string" } },
        required: ["url", "title"],
      },
      render: (_args, value) => `Reloaded: ${value.url}`,
      timeoutMs: timeout(),
      execute: () => reloadTool(config),
    }),
    definePlainTool({
      name: "browser_status",
      description: "查看浏览器会话是否打开、当前 URL 与标题。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          open: { type: "boolean" },
          profile: { type: "string" },
          channel: { type: "string" },
          tabs: { type: "integer" },
          profiles: { type: "array", items: { type: "object" } },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["open", "profile", "channel", "tabs", "profiles"],
      },
      render: (_args, value) =>
        value.open ? `Open (${value.channel}): ${value.url} — ${value.title}` : "Not open",
      timeoutMs: timeout(),
      execute: () => statusTool(),
    }),
    definePlainTool({
      name: "browser_close",
      description: "关闭浏览器会话并释放资源;下次使用工具时会自动重新打开。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { closed: { type: "boolean" } },
        required: ["closed"],
      },
      render: () => "Browser closed",
      execute: () => closeTool(),
    }),
    definePlainTool({
      name: "browser_tabs",
      description:
        "管理浏览器多标签页:list 列出所有标签,new 新建(可选带 url),switch 按 id 或 index 切换,close 关闭指定标签。id 来自 list 结果。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "new", "switch", "close"] },
          url: { type: "string", description: "new 时打开的新标签 URL。" },
          id: { type: "integer", description: "目标标签 id(list 返回)。" },
          index: { type: "integer", description: "目标标签序号(0 起)。" },
          waitUntil: { type: "string", enum: ["load", "domcontentloaded", "commit"] },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string" },
          tab: { type: "object" },
          tabs: { type: "array", items: { type: "object" } },
          activeId: { type: "integer" },
        },
        required: ["action", "tabs", "activeId"],
      },
      render: (args, value) => {
        const lines = value.tabs.map(
          (t: any) => `${t.id === value.activeId ? "▶" : " "} #${t.id} ${t.url}${t.title ? ` — ${t.title}` : ""}`,
        );
        return `tabs ${value.action}: ${lines.join("\n") || "(none)"}`;
      },
      timeoutMs: timeout(),
      execute: (args) => tabsTool(config, args),
    }),
    definePlainTool({
      name: "browser_profile",
      description:
        "多浏览器配置文件:list 列出配置的 profiles(work/personal…)与当前会话状态,use <name> 切换当前 profile(后续浏览器工具作用于该 profile)。每个 profile 可配置独立 userDataDir(登录态隔离)。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "use"] },
          name: { type: "string", description: "use 时的 profile 名(default 或配置的)。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          current: { type: "string" },
          profiles: { type: "array", items: { type: "object" } },
        },
        required: ["current", "profiles"],
      },
      render: (args, value) => {
        if (args.action === "use") return `Switched to profile "${value.current}"`;
        return value.profiles
          .map((p: any) => `${p.name === value.current ? "▶" : " "} ${p.name}${p.open ? ` (open, ${p.tabs} tabs${p.persistent ? ", persistent" : ""})` : " (closed)"}${p.userDataDir ? ` → ${p.userDataDir}` : ""}`)
          .join("\n") || "(no profiles configured)";
      },
      timeoutMs: timeout(),
      execute: (args) => profileTool(config, args),
    }),
    definePlainTool({
      name: "browser_context",
      description:
        "命名隔离上下文:同一浏览器进程内 cookies/storage 完全隔离的\"标签组\"。action:new(name 可省略自动编号,可选 url 直接打开)/ list / switch(name,激活该组页面,组内页全关则在原 context 新开,登录态仍在)/ close(name,整组关闭)。适合多账号并行验证、需要干净会话的抓取。页注册进普通标签表,所有浏览器工具直接可用;browser_tabs 也能看到/切换这些页。持久模式(userDataDir)不支持,请改用 profiles。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "new", "switch", "close"], description: "默认 list。" },
          name: { type: "string", description: "上下文名(new 自动编号时可省略;switch/close 必填)。" },
          url: { type: "string", description: "new 时可选:新页直接打开的 URL。" },
        },
        additionalProperties: false,
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
                createdAt: { type: "integer" },
              },
              required: ["name", "pages", "active", "createdAt"],
              additionalProperties: false,
            },
          },
          profile: { type: "string" },
          created: { type: "string" },
          navigated: { type: "string" },
          switched: { type: "string" },
          closed: { type: "string" },
          remainingTabs: { type: "integer" },
          pages: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: [],
      },
      render: (args, value) => {
        if (args.action === "new" || value.created) return `新建隔离上下文 "${value.created}"${value.navigated ? ` → ${value.navigated}` : ""}`;
        if (args.action === "switch" || value.switched) return `切换到上下文 "${value.switched}": ${value.url}`;
        if (args.action === "close" || value.closed) return `关闭上下文 "${value.closed}"(剩余 ${value.remainingTabs} 标签)`;
        return (
          (value.contexts as any[]).map((c) => `${c.active ? "▶" : " "} ${c.name}(${c.pages} 页)`).join("\n") ||
          "(无隔离上下文;browser_context { action: \"new\" } 创建)"
        );
      },
      timeoutMs: timeout(),
      execute: (args) => contextTool(config, args),
    })
  ];
}
