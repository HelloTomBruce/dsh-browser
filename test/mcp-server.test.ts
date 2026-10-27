// dsh-browser · MCP server 协议级单测(InMemoryTransport,不起浏览器)
//
// 覆盖:initialize instructions 与 DSH systemPrompt 同源、tools/list 计数
// (all=38 / core=25,与 toolset.test.ts 契约同值)、工具 schema 形状、
// browser_status 无浏览器调用、未知工具协议错误。

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBrowserMcpServer } from "../src/mcp.js";
import { BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG } from "../src/lib/schema.js";
import { resolveConfig } from "../src/lib/config.js";
import type { BrowserConfig } from "../src/browser/types.js";

let homeDir: string;
let previousDshHome: string | undefined;

beforeAll(() => {
  // 隔离录制/报告资产,避免触碰真实 ~/.dsh
  previousDshHome = process.env.DSH_HOME;
  homeDir = mkdtempSync(join(tmpdir(), "dsh-browser-mcp-test-"));
  process.env.DSH_HOME = homeDir;
});

afterAll(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  rmSync(homeDir, { recursive: true, force: true });
});

function makeConfig(overrides: Record<string, unknown> = {}): BrowserConfig {
  return resolveConfig("dsh-browser-mcp", BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG, overrides) as BrowserConfig;
}

async function connectClient(config: BrowserConfig): Promise<Client> {
  const server = createBrowserMcpServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "vitest-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("MCP server (protocol-level)", () => {
  it("initialize:instructions 与 DSH systemPrompt 同源(含语义定位指引)", async () => {
    const client = await connectClient(makeConfig());
    try {
      const instructions = client.getInstructions();
      expect(instructions).toContain("共享浏览器会话");
      expect(instructions).toContain("意图语义定位");
      expect(client.getServerVersion()?.name).toBe("dsh-browser-view");
    } finally {
      await client.close();
    }
  });

  it("tools/list(toolset=all):38 个,与 toolset 契约同值;schema 形状完整", async () => {
    const client = await connectClient(makeConfig());
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(38);
      for (const tool of tools) {
        expect(tool.name.startsWith("browser_")).toBe(true);
        expect((tool.description ?? "").length).toBeGreaterThan(2);
        expect((tool.inputSchema as { type?: string }).type).toBe("object");
        const outputSchema = tool.outputSchema as { type?: string; properties?: unknown } | undefined;
        expect(outputSchema?.type).toBe("object");
        expect(Object.keys(outputSchema?.properties ?? {}).length).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
    }
  });

  it("tools/list(toolset=core):25 个核心集", async () => {
    const client = await connectClient(makeConfig({ toolset: "core" }));
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(25);
      const names = tools.map((t) => t.name);
      expect(names).toContain("browser_click");
      expect(names).not.toContain("browser_replay");
    } finally {
      await client.close();
    }
  });

  it("tools/call browser_status:无浏览器安全返回 open:false(text + structuredContent 双通道)", async () => {
    const client = await connectClient(makeConfig());
    try {
      const result = (await client.callTool({ name: "browser_status", arguments: {} })) as {
        content: Array<{ type: string; text?: string }>;
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
      };
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.type).toBe("text");
      // statusTool 有自定义 render(人类可读文本);结构化数据走 structuredContent
      expect((result.structuredContent as { open?: boolean }).open).toBe(false);
      expect((result.content[0]?.text ?? "").length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });

  it("tools/call 未知工具:协议错误(非 isError 结果)", async () => {
    const client = await connectClient(makeConfig());
    try {
      await expect(client.callTool({ name: "browser_nope", arguments: {} })).rejects.toThrow(/未知工具/);
    } finally {
      await client.close();
    }
  });
});
