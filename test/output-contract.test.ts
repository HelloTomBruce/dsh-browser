// 契约测试:确保每个工具的「实现返回值」与「声明的 outputSchema」一致。
//
// 背景:宿主会按 outputSchema 严格校验工具返回值,schema 未声明的字段会导致
// 工具在真实会话中报 "returned invalid output"(操作实际已成功)。本测试覆盖:
//   1. 静态:所有工具都声明 outputSchema,且 properties 非空(防新增工具漏写);
//   2. 动态:不依赖真实浏览器的纯逻辑工具,execute 后用 schema 校验返回值。
//
// 校验器为零依赖内置实现(约 60 行),只支持本项目 outputSchema 用到的子集:
// type / properties / required / additionalProperties:false / items / enum。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTools } from "../src/browser/register.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { PlainToolDefinition } from "../src/lib/types.js";
import {
  addNetworkEntry, clearNetwork, currentProfile, clearTestLog, savedRecordings,
  startRecording, stopRecording, recordCall,
} from "../src/browser/session.js";
import { compressText } from "../src/browser/tools.js";

// ---------------------------------------------------------------------------
// 最小 JSON-Schema 子集校验器(对齐宿主的严格校验语义)
// ---------------------------------------------------------------------------

type Schema = Record<string, any>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value: unknown, want: string): boolean {
  const actual = typeOf(value);
  if (want === "integer") return actual === "integer";
  if (want === "number") return actual === "number" || actual === "integer";
  return actual === want;
}

/** 校验 value 是否符合 schema;返回错误路径列表(空 = 通过)。 */
function validateSchema(schema: Schema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  if (schema === undefined || Object.keys(schema).length === 0) return errors; // 空 schema 不约束
  if (schema.type !== undefined && !typeMatches(value, String(schema.type))) {
    errors.push(`${path}: 期望 ${schema.type},实际 ${typeOf(value)}`);
    return errors; // 类型不符就不再深入
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: 不在枚举 ${JSON.stringify(schema.enum)} 内`);
  }
  if (schema.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required 但缺失`);
    }
    for (const [key, val] of Object.entries(obj)) {
      if (props[key] !== undefined) {
        errors.push(...validateSchema(props[key], val, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: 未声明的字段(additionalProperties:false)`);
      }
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, i) => errors.push(...validateSchema(schema.items, item, `${path}[${i}]`)));
  }
  return errors;
}

const CONFIG: BrowserConfig = {
  channel: "auto",
  headless: true,
  profiles: { work: { headless: true } },
  timeoutMs: 5000,
};

/** 捕获 registerTools 注册的全部工具定义。 */
function captureTools(): Map<string, PlainToolDefinition> {
  const defs: PlainToolDefinition[] = [];
  const ctx = {
    get(name: string) {
      if (name === "tools") return { register: (d: PlainToolDefinition) => defs.push(d) };
      return undefined;
    },
    effect: () => {},
  };
  registerTools(ctx as any, CONFIG);
  return new Map(defs.map((d) => [d.name, d]));
}

const tools = captureTools();
const execStub = { signal: new AbortController().signal } as any;

async function run(name: string, args: Record<string, any>): Promise<any> {
  const def = tools.get(name);
  if (def === undefined) throw new Error(`tool not registered: ${name}`);
  return def.execute(args, execStub);
}

function expectValid(name: string, value: unknown): void {
  const def = tools.get(name);
  if (def === undefined) throw new Error(`tool not registered: ${name}`);
  const errors = validateSchema(def.output.schema, value);
  expect(
    errors,
    `${name} 返回值不符合 outputSchema(实际值: ${JSON.stringify(value)?.slice(0, 300)})`,
  ).toEqual([]);
}

let tmpHome: string;
const origHome = process.env.DSH_HOME;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "dsh-browser-contract-"));
  process.env.DSH_HOME = tmpHome;
});

afterAll(() => {
  if (origHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("静态契约:所有工具声明完整 outputSchema", () => {
  it("校验器能发现 P0 修复的三类错误(类型错误/未声明字段/required 缺失)", () => {
    const s = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "array" } },
      required: ["a"],
    };
    expect(validateSchema(s, { a: [] })).toEqual([]);
    expect(validateSchema(s, { a: 0 })).not.toEqual([]); // network clear 旧 bug: entries 为 integer
    expect(validateSchema(s, { a: [], extra: 1 })).not.toEqual([]); // wait/record 旧 bug: 未声明字段
    expect(validateSchema(s, {})).not.toEqual([]); // required 缺失
  });

  it("注册了全部 38 个 browser_* 工具", () => {
    expect(tools.size).toBe(38);
  });

  it("每个工具的 outputSchema 都是带 properties 的对象 schema", () => {
    for (const [name, def] of tools) {
      const schema = def.output.schema as any;
      expect(schema.type, `${name} outputSchema.type`).toBe("object");
      expect(
        schema.properties && Object.keys(schema.properties).length > 0,
        `${name} outputSchema.properties 不能为空(宿主会严格校验返回值)`,
      ).toBe(true);
      expect(Array.isArray(schema.required), `${name} outputSchema.required 应为数组`).toBe(true);
    }
  });
});

describe("browser_network 返回值契约", () => {
  it("list / failed / clear", async () => {
    clearNetwork(currentProfile);
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/ok",
      method: "GET",
      resourceType: "xhr",
      status: 200,
      ok: true,
      startedAt: Date.now(),
      durationMs: 10,
    });
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/bad",
      method: "POST",
      resourceType: "fetch",
      status: 500,
      ok: false,
      startedAt: Date.now(),
      durationMs: 20,
    });
    expectValid("browser_network", await run("browser_network", { action: "list" }));
    expectValid("browser_network", await run("browser_network", { action: "failed" }));
    const cleared = await run("browser_network", { action: "clear" });
    expectValid("browser_network", cleared);
    expect(cleared.entries).toEqual([]);
  });

  it("wait 命中时返回 matched 与真实 waitMs", async () => {
    clearNetwork(currentProfile);
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/hit",
      method: "GET",
      resourceType: "xhr",
      status: 200,
      ok: true,
      startedAt: Date.now(),
    });
    const value = await run("browser_network", { action: "wait", url: "api/hit" });
    expectValid("browser_network", value);
    expect(value.matched.url).toContain("api/hit");
    expect(typeof value.waitMs).toBe("number");
    expect(value.waitMs).toBeGreaterThanOrEqual(0);
    expect(value.waitMs).toBeLessThan(10_000);
  });

  it("wait 超时报错附最近已见请求摘要", async () => {
    clearNetwork(currentProfile);
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/seen",
      method: "POST",
      resourceType: "xhr",
      status: 200,
      ok: true,
      startedAt: Date.now(),
    });
    const err = await run("browser_network", { action: "wait", url: "api/not-exist", timeoutMs: 1000 }).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(err).toContain("等待接口超时");
    expect(err).toContain("最近已见请求");
    expect(err).toContain("api/seen");
  });

  it("stats 按 host 聚合并符合 schema", async () => {
    clearNetwork(currentProfile);
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/a",
      method: "GET",
      resourceType: "xhr",
      status: 200,
      ok: true,
      startedAt: Date.now(),
      durationMs: 100,
    });
    addNetworkEntry(currentProfile, {
      url: "http://127.0.0.1:7001/api/b",
      method: "POST",
      resourceType: "xhr",
      status: 500,
      ok: false,
      startedAt: Date.now(),
      durationMs: 300,
    });
    addNetworkEntry(currentProfile, {
      url: "https://example.com/api/c",
      method: "GET",
      resourceType: "fetch",
      status: 200,
      ok: true,
      startedAt: Date.now(),
      durationMs: 50,
    });
    const value = await run("browser_network", { action: "stats" });
    expectValid("browser_network", value);
    expect(value.stats).toHaveLength(2);
    const local = value.stats.find((s: any) => s.host === "127.0.0.1:7001");
    expect(local.total).toBe(2);
    expect(local.failed).toBe(1);
    expect(local.avgMs).toBe(200);
    expect(local.byStatus).toEqual({ "200": 1, "500": 1 });
    expect(value.stats[0].total).toBeGreaterThanOrEqual(value.stats[1].total); // 按总数降序
  });
});

describe("browser_record 返回值契约与录制语义", () => {
  it("无录制 buffer 时 save 回退到最近操作轨迹(source=recent-log)", async () => {
    clearTestLog();
    const value = await run("browser_record", { action: "save", name: "contract-recent" });
    expectValid("browser_record", value);
    expect(value.source).toBe("recent-log");
    expect(typeof value.file).toBe("string");
    expect(savedRecordings.has("contract-recent")).toBe(true);
  });

  it("start→调用→stop→save 使用录制 buffer(source=recording),不含录制前步骤", async () => {
    await run("browser_record", { action: "start" });
    await run("browser_network", { action: "clear" }); // 一步可录制调用
    const stopped = await run("browser_record", { action: "stop" });
    expectValid("browser_record", stopped);
    expect(stopped.steps).toBe(1);

    await run("browser_network", { action: "clear" }); // stop 之后的调用不应被保存
    const saved = await run("browser_record", { action: "save", name: "contract-recorded" });
    expectValid("browser_record", saved);
    expect(saved.source).toBe("recording");
    expect(saved.steps).toBe(1);
    const steps = savedRecordings.get("contract-recorded")!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].tool).toBe("browser_network");
  });

  it("list / delete", async () => {
    expectValid("browser_record", await run("browser_record", { action: "list" }));
    expectValid("browser_record", await run("browser_record", { action: "delete", name: "contract-recent" }));
    expectValid("browser_record", await run("browser_record", { action: "delete", name: "contract-recorded" }));
  });

  it("save 检查 upload 外部依赖并返回 warnings", async () => {
    startRecording();
    recordCall({ tool: "browser_upload", args: { path: "/nonexistent/导入文件.xlsx" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_click", args: { selector: "#btn" }, ok: true, ms: 1, ts: Date.now() });
    stopRecording();
    const saved = await run("browser_record", { action: "save", name: "contract-warn" });
    expectValid("browser_record", saved);
    expect(saved.source).toBe("recording");
    expect(saved.warnings).toHaveLength(1);
    expect(saved.warnings[0]).toContain("browser_upload");
    expect(saved.warnings[0]).toContain("/nonexistent/导入文件.xlsx");
    // 存在的文件不预警
    startRecording();
    recordCall({ tool: "browser_upload", args: { path: join(process.cwd(), "package.json") }, ok: true, ms: 1, ts: Date.now() });
    stopRecording();
    const saved2 = await run("browser_record", { action: "save", name: "contract-nowarn" });
    expectValid("browser_record", saved2);
    expect(saved2.warnings).toBeUndefined();
    await run("browser_record", { action: "delete", name: "contract-warn" });
    await run("browser_record", { action: "delete", name: "contract-nowarn" });
  });

  it("stripReads 剔除只读步骤(保留操作步骤)", async () => {
    startRecording();
    recordCall({ tool: "browser_snapshot", args: {}, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_click", args: { selector: "#btn" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_network", args: { action: "list" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_cookies", args: { action: "list" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_cookies", args: { action: "set", name: "a", value: "b" }, ok: true, ms: 1, ts: Date.now() });
    stopRecording();
    const saved = await run("browser_record", { action: "save", name: "contract-strip", stripReads: true });
    expectValid("browser_record", saved);
    expect(saved.steps).toBe(2); // click + cookies set
    expect(saved.stripped).toBe(3); // snapshot + network + cookies list
    const tools_ = savedRecordings.get("contract-strip")!.steps.map((s) => s.tool);
    expect(tools_).toEqual(["browser_click", "browser_cookies"]);
    // 默认 stripReads=false 不剔除
    startRecording();
    recordCall({ tool: "browser_snapshot", args: {}, ok: true, ms: 1, ts: Date.now() });
    stopRecording();
    const kept = await run("browser_record", { action: "save", name: "contract-keep" });
    expect(kept.steps).toBe(1);
    expect(kept.stripped).toBeUndefined();
    await run("browser_record", { action: "delete", name: "contract-strip" });
    await run("browser_record", { action: "delete", name: "contract-keep" });
  });
});

describe("browser_forms / browser_form_save 返回值契约", () => {
  it("save 指定 fields → list → delete", async () => {
    expectValid(
      "browser_form_save",
      await run("browser_form_save", { name: "f1", fields: [{ selector: "#a", value: "1" }] }),
    );
    expectValid("browser_forms", await run("browser_forms", { action: "list" }));
    expectValid("browser_forms", await run("browser_forms", { action: "delete", name: "f1" }));
  });
});

describe("browser_profile 返回值契约", () => {
  it("list 与 use", async () => {
    expectValid("browser_profile", await run("browser_profile", { action: "list" }));
    expectValid("browser_profile", await run("browser_profile", { action: "use", name: "work" }));
    expectValid("browser_profile", await run("browser_profile", { action: "use", name: "default" }));
  });
});

describe("browser_replay 返回值契约", () => {  it("回放纯逻辑步骤(不启动浏览器)", async () => {
    const value = await run("browser_replay", {
      steps: [
        { tool: "browser_network", args: { action: "clear" } },
        { tool: "browser_network", args: { action: "list" } },
      ],
    });
    expectValid("browser_replay", value);
    expect(value.passed).toBe(2);
    expect(value.failed).toBe(0);
  });

  it("未知步骤工具时 failFast 停止", async () => {
    const value = await run("browser_replay", {
      steps: [
        { tool: "browser_nope", args: {} },
        { tool: "browser_network", args: { action: "clear" } },
      ],
    });
    expectValid("browser_replay", value);
    expect(value.failed).toBe(1);
    expect(value.stoppedAt).toBe(0);
  });
});

describe("browser_batch 返回值契约", () => {
  it("纯逻辑步骤批处理(browser_status 不启动浏览器)", async () => {
    const value = await run("browser_batch", {
      steps: [
        { tool: "browser_status", args: {} },
        { tool: "browser_network", args: { action: "clear" } },
      ],
    });
    expectValid("browser_batch", value);
    expect(value.passed).toBe(2);
    expect(value.failed).toBe(0);
    expect(typeof value.summary).toBe("string");
  });

  it("步骤内嵌套 batch/replay/record 报「不允许嵌套」", async () => {
    for (const nested of ["browser_batch", "browser_replay", "browser_record"]) {
      const value = await run("browser_batch", {
        steps: [{ tool: nested, args: {} }],
        failFast: false,
      });
      expectValid("browser_batch", value);
      expect(value.failed).toBe(1);
      expect(value.results[0].error).toContain("不允许嵌套");
    }
  });

  it("空 steps 抛错", async () => {
    await expect(run("browser_batch", { steps: [] })).rejects.toThrow(/非空 steps/);
  });
});

describe("browser_report 返回值契约", () => {
  it("list 含此前 replay/batch 的运行记录", async () => {
    const value = await run("browser_report", { action: "list" });
    expectValid("browser_report", value);
    expect(Array.isArray(value.runs)).toBe(true);
    // 此前 describe 已跑过 replay/batch,运行历史应非空
    expect(value.runs.length).toBeGreaterThanOrEqual(2);
    expect(value.runs[0]).toHaveProperty("runId");
  });

  it("show 返回最近一条完整记录", async () => {
    const value = await run("browser_report", { action: "show" });
    expectValid("browser_report", value);
    expect(value.run.total).toBeGreaterThan(0);
    expect(Array.isArray(value.run.results)).toBe(true);
  });

  it("export 生成 Markdown 并落盘工作区", async () => {
    CONFIG.workspaceDir = tmpHome; // 落盘走临时目录
    const value = await run("browser_report", { action: "export", file: "reports/contract.md" });
    expectValid("browser_report", value);
    expect(value.format).toBe("markdown");
    expect(value.runs).toBeGreaterThanOrEqual(1);
    expect(existsSync(value.file)).toBe(true);
    await run("browser_report", { action: "export", format: "html", file: "reports/contract.html" });
  });
});

describe("compressText 快照文本压缩", () => {
  it("折叠连续空白行为 1 行并去首尾空白行", () => {
    const input = "\n\n标题\n\n\n\n正文\n\n";
    expect(compressText(input)).toBe("标题\n\n正文");
  });

  it("折叠连续重复的非空行并标注重复次数", () => {
    const input = "丽水\nXSDU\n \n \n \n台州";
    // 空白行(含纯空格)折叠为 1 个空行
    expect(compressText(input)).toBe("丽水\nXSDU\n\n台州");
    expect(compressText("A\nA\nA\nB")).toBe("A\n…(重复 2 行)\nB");
  });

  it("不重排、不删改非重复内容", () => {
    const input = "第一行\n第二行\n第一行"; // 非相邻重复不折叠
    expect(compressText(input)).toBe(input);
  });

  it("空文本与纯空白文本", () => {
    expect(compressText("")).toBe("");
    expect(compressText("\n\n  \n")).toBe("");
  });
});
