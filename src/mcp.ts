// dsh-browser · 独立 MCP server 入口(stdio)
//
// 第三个消费面:脱离 DSH 宿主,让任意 MCP 客户端(Claude Desktop/ZCode/
// Cursor 等)直接调用全部 browser_* 工具。核心层零改动——stub ctx 收集
// registerTools 注册的定义,审批闸/打点/录制等包装层机制与 DSH 宿主逐行
// 为一致(DocMind 01「独立 MCP 入口」)。
//
// 配置走环境变量 DSH_BROWSER_<大写蛇形> → camelCase,拼成 raw config 后
// 过同一 resolveConfig,校验与默认值完全复用(DocMind 09;不新增 SCHEMA 键)。
//
// ⚠️ stdout 是协议通道:本进程一切日志必须走 stderr(shim logger 已路由)。

import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveConfig } from "./lib/config.js";
import { BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG } from "./lib/schema.js";
import { browserSystemPrompt } from "./lib/prompts.js";
import { registerTools } from "./browser/register.js";
import { setDoctorProbe } from "./browser/tools.js";
import { closeBrowser, sweepScreenshotDir } from "./browser/session.js";
import { loadRecordings } from "./browser/recordings.js";
import type { ReefContext, PlainToolDefinition, ToolRunContext } from "./lib/types.js";
import type { BrowserConfig } from "./browser/types.js";

const ENV_PREFIX = "DSH_BROWSER_";

/**
 * 环境变量 → raw config(DSH_BROWSER_TIMEOUT_MS → timeoutMs)。
 * 值按目标键的 SCHEMA 类型解析:boolean/number 直转,string[] 逗号分隔,
 * any/object 尝试 JSON.parse(失败回退原字符串),其余原样。
 * 嵌套键(profiles/confirmPolicies/humanize)不支持 env,走 JSON 键时可用。
 */
export function configFromEnv(env: NodeJS.ProcessEnv): Record<string, any> {
  const raw: Record<string, any> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(ENV_PREFIX) || value === undefined || value === "") continue;
    const camel = key
      .slice(ENV_PREFIX.length)
      .toLowerCase()
      .split("_")
      .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join("");
    const declared = (BROWSER_CONFIG_SCHEMA as Record<string, { type?: string }>)[camel];
    const type = declared?.type;
    if (type === "boolean") {
      raw[camel] = value === "true";
    } else if (type === "number") {
      raw[camel] = Number(value);
    } else if (type === "string[]") {
      raw[camel] = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (type === "any" || type === "object") {
      try {
        raw[camel] = JSON.parse(value);
      } catch {
        raw[camel] = value;
      }
    } else {
      raw[camel] = value;
    }
  }
  return raw;
}

/** 收集 registerTools 注册的工具定义(包装层已生效:审批闸/打点/录制)。 */
export function collectToolDefinitions(config: BrowserConfig): Map<string, PlainToolDefinition> {
  const defs = new Map<string, PlainToolDefinition>();
  const shim: ReefContext = {
    // stdout 是 MCP 协议通道,插件日志一律转 stderr。
    logger: {
      info: (m) => console.error(m),
      warn: (m) => console.error(m),
      error: (m) => console.error(m),
    },
    get: ((name: string) => {
      if (name === "tools") {
        return { register: (def: PlainToolDefinition) => void defs.set(def.name, def) };
      }
      return undefined;
    }) as ReefContext["get"],
    effect: () => {},
  };
  registerTools(shim, config);
  return defs;
}

/** 按 DSH 宿主同款语义执行:def.timeoutMs 截断(definitions 已为长等待编码 600s)。 */
async function executeWithTimeout(
  def: PlainToolDefinition,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<unknown> {
  if (def.timeoutMs === undefined) return def.execute(args, exec);
  const timeoutMs = def.timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      def.execute(args, exec),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${def.name} 执行超时(${timeoutMs}ms),已被 MCP 宿主截断`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 组装 MCP server(不绑定传输,便于 InMemoryTransport 单测)。
 * instructions 与 DSH systemPrompt 同源;inputSchema/outputSchema 直传
 * PlainToolDefinition 的 JSON Schema,不做 zod 转换。
 */
export function createBrowserMcpServer(config: BrowserConfig): Server {
  const defs = collectToolDefinitions(config);
  const server = new Server(
    { name: "dsh-browser-view", version: resolvePackageVersion() },
    {
      instructions: browserSystemPrompt(config),
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, (): ListToolsResult => ({
    tools: [...defs.values()].map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.parameters as ListToolsResult["tools"][number]["inputSchema"],
      outputSchema: def.output.schema as ListToolsResult["tools"][number]["outputSchema"],
    })),
  }));

  server.setRequestHandler(
    CallToolRequestSchema,
    (request, extra): CallToolResult | Promise<CallToolResult> => {
      const name = request.params.name;
      const def = defs.get(name);
      if (def === undefined) {
        throw new Error(`未知工具: ${name}(可用工具见 tools/list,共 ${defs.size} 个)`);
      }
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const exec: ToolRunContext = {
        signal: extra.signal,
        cwd: process.cwd(),
      };
      return executeWithTimeout(def, args, exec)
        .then((value) => {
          // output.render 本就是 [{type:"text",text}] —— 与 MCP content 同构,直传。
          const content = def.output.render(args, value) as CallToolResult["content"];
          const result: CallToolResult = { content };
          if (value !== null && typeof value === "object") {
            result.structuredContent = value as Record<string, unknown>;
          }
          return result;
        })
        .catch((e: unknown) => ({
          content: [
            {
              type: "text",
              text: `${name} 失败: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true as const,
        }));
    },
  );

  return server;
}

/** 从产物同目录的 package.json 读版本(lib/mcp.js 与 package.json 同包根)。 */
function resolvePackageVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(): Promise<void> {
  const resolved = resolveConfig(
    "dsh-browser-mcp",
    BROWSER_CONFIG_SCHEMA,
    BROWSER_DEFAULT_CONFIG,
    configFromEnv(process.env),
  );
  if (resolved.enabled === false) {
    console.error("dsh-browser-mcp: enabled=false,退出");
    process.exit(0);
  }
  const config = resolved as BrowserConfig;

  // 与 DSH 入口对齐:加载磁盘录制资产 + 每小时截图清扫;MCP 模式无面板探针。
  const loaded = loadRecordings();
  if (loaded > 0) console.error(`dsh-browser-mcp: loaded ${loaded} saved recording(s)`);
  setDoctorProbe(null);
  const sweepTimer = setInterval(() => {
    try {
      sweepScreenshotDir({ maxAgeDays: config.screenshotMaxAgeDays, maxCount: config.screenshotMaxCount });
    } catch {
      /* ignore */
    }
  }, 60 * 60 * 1000);
  sweepTimer.unref?.();

  const server = createBrowserMcpServer(config);
  const transport = new StdioServerTransport();

  let exiting = false;
  const shutdown = async (reason: string) => {
    if (exiting) return;
    exiting = true;
    clearInterval(sweepTimer);
    try {
      // closeBrowser 可能被卡死的浏览器挂住,外层 5s race 兜底。
      await Promise.race([closeBrowser(), delay(5_000)]);
    } catch {
      /* ignore */
    }
    console.error(`dsh-browser-mcp: ${reason},已退出`);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  transport.onclose = () => void shutdown("stdio closed");

  await server.connect(transport);
  console.error(
    `dsh-browser-mcp: stdio server ready (toolset=${config.toolset}, headless=${config.headless}, profile=${config.userDataDir || "ephemeral"})`,
  );
}

// bin 直跑守卫:被 import(单测/复用)时不自动启动。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
