import { describe, it, expect } from "vitest";
import { definePlainTool, workspaceCwd, genericCard } from "../src/lib/tools.js";

describe("definePlainTool", () => {
  it("生成完整 ToolDefinition 形状", () => {
    const tool = definePlainTool({
      name: "demo_tool",
      description: "demo",
      parameters: { type: "object", properties: { a: { type: "string" } } },
      execute: async () => ({ ok: true }),
    });
    expect(tool.name).toBe("demo_tool");
    expect(tool.description).toBe("demo");
    expect(tool.parameters.type).toBe("object");
    expect(tool.output.schema.type).toBe("object");
    expect(typeof tool.execute).toBe("function");
    expect(typeof tool.output.render).toBe("function");
  });

  it("默认 render 输出 JSON 文本块", () => {
    const tool = definePlainTool({
      name: "t",
      description: "d",
      parameters: {},
      execute: async () => ({ a: 1 }),
    });
    const blocks = tool.output.render({}, { a: 1 });
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toContain('"a": 1');
  });

  it("自定义 render 生效", () => {
    const tool = definePlainTool({
      name: "t",
      description: "d",
      parameters: {},
      render: (_args, value) => `got ${(value as any).x}`,
      execute: async () => ({ x: 5 }),
    });
    expect(tool.output.render({}, { x: 5 })[0].text).toBe("got 5");
  });

  it("outputSchema 显式声明时使用", () => {
    const tool = definePlainTool({
      name: "t",
      description: "d",
      parameters: {},
      outputSchema: { type: "object", additionalProperties: false, properties: { a: { type: "string" } } },
      execute: async () => ({ a: "x" }),
    });
    expect(tool.output.schema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("concurrencySafe 与 timeoutMs 透传", () => {
    const tool = definePlainTool({
      name: "t",
      description: "d",
      parameters: {},
      concurrencySafe: true,
      timeoutMs: 5000,
      execute: async () => ({}),
    });
    expect(tool.isConcurrencySafe?.()).toBe(true);
    expect(tool.timeoutMs).toBe(5000);
  });
});

describe("workspaceCwd", () => {
  it("优先使用会话 cwd", () => {
    const cwd = workspaceCwd({ agent: { session: { meta: { cwd: "/tmp/x" } } } } as any);
    expect(cwd).toBe("/tmp/x");
  });

  it("缺失时回退进程 cwd", () => {
    expect(workspaceCwd(undefined)).toBe(process.cwd());
    expect(workspaceCwd({} as any)).toBe(process.cwd());
  });
});

describe("genericCard", () => {
  it("生成 generic 卡片视图", () => {
    expect(genericCard("browser", "https://a.com", "https://a.com")).toEqual({
      card: "generic",
      kind: "browser",
      title: "https://a.com",
      rawInput: "https://a.com",
    });
  });
});
