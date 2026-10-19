// F5 录制参数化:占位符替换 / vars 抽取 / 数据集回放
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPlaceholders, substituteVars, recordTool, replayTool,
} from "../src/browser/tools.js";
import {
  savedRecordings, savedForms, clearTestLog, startRecording, stopRecording, recordCall,
} from "../src/browser/session.js";

let tmpHome: string;
const origHome = process.env.DSH_HOME;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "dsh-browser-params-"));
  process.env.DSH_HOME = tmpHome; // save 落盘走临时目录,不污染真实 $DSH_HOME
});
afterAll(() => {
  if (origHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

/** 收集并清空各测试文件共享的模块级状态(录制表/轨迹)。 */
beforeEach(() => {
  for (const name of [...savedRecordings.keys()]) savedRecordings.delete(name);
  savedForms.clear();
  clearTestLog();
});

describe("findPlaceholders / substituteVars", () => {
  const steps = [
    { tool: "browser_type", args: { selector: "#u", text: "{{user}}" } },
    { tool: "browser_open", args: { url: "https://x.com/?q={{kw}}" } },
    { tool: "browser_click", args: { selector: "#go" } },
    { tool: "browser_type", args: { selector: "#p", text: "{{user}}-{{pass}}" } },
  ];

  it("收集所有占位符名(去重)", () => {
    expect(findPlaceholders(steps).sort()).toEqual(["kw", "pass", "user"]);
  });

  it("替换字符串叶子中的占位符", () => {
    const out = substituteVars(steps, { user: "张三", pass: "pw", kw: "q" });
    expect(out[0].args.text).toBe("张三");
    expect(out[1].args.url).toBe("https://x.com/?q=q");
    expect(out[3].args.text).toBe("张三-pw");
    // 原步骤不被修改
    expect(steps[0].args.text).toBe("{{user}}");
  });

  it("缺失的占位符保留原样", () => {
    const out = substituteVars(steps, { user: "a" });
    expect(out[3].args.text).toBe("a-{{pass}}");
  });
});

describe("record save 的 vars 参数化", () => {
  it("指定步骤字段替换为 {{占位符}} 并回显 varsApplied", async () => {
    startRecording();
    recordCall({ tool: "browser_type", args: { selector: "#u", text: "a@x.com" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_type", args: { selector: "#p", text: "secret" }, ok: true, ms: 1, ts: Date.now() });
    recordCall({ tool: "browser_click", args: { selector: "#go" }, ok: true, ms: 1, ts: Date.now() });
    stopRecording();

    const result: any = await recordTool({ action: "save", name: "t-vars", vars: { username: "#1.args.text", password: "#2.args.text" } });
    expect(result.varsApplied).toBe(2);
    const saved = savedRecordings.get("t-vars")!;
    expect(saved.steps[0].args.text).toBe("{{username}}");
    expect(saved.steps[1].args.text).toBe("{{password}}");
    expect(saved.steps[2].args.selector).toBe("#go");
  });

  it("vars 路径格式非法时报错", async () => {
    await expect(
      recordTool({ action: "save", name: "t-bad", vars: { x: "no-hash" } }),
    ).rejects.toThrow(/#步骤号\.args\.字段/);
  });

  it("vars 步骤号越界时报错", async () => {
    await expect(
      recordTool({ action: "save", name: "t-oob", vars: { x: "#99.args.text" } }),
    ).rejects.toThrow(/步骤 #99 不存在/);
  });
});

describe("replay 的 vars / data 数据驱动", () => {
  beforeEach(() => {
    savedRecordings.set("t-login", {
      savedAt: Date.now(),
      steps: [
        { tool: "noop", args: { text: "{{user}}" } },
        { tool: "ok", args: {} },
      ],
    });
  });

  const impls = {
    noop: async (args: any) => args,
    ok: async () => ({ ok: true }),
  };

  it("缺变量时直接报错并列出缺失", async () => {
    await expect(replayTool({ name: "t-login" }, impls)).rejects.toThrow(/缺少变量: user/);
  });

  it("vars 注入后单次回放通过", async () => {
    const r: any = await replayTool({ name: "t-login", vars: { user: "张三" } }, impls);
    expect(r).toMatchObject({ source: "t-login", total: 2, passed: 2, failed: 0 });
  });

  it("data 数据集逐行回放并聚合", async () => {
    const r: any = await replayTool(
      { name: "t-login", data: [{ user: "a" }, { user: "b" }] },
      impls,
    );
    expect(r.rows).toBe(2);
    expect(r.passedRows).toBe(2);
    expect(r.failedRows).toBe(0);
    expect(r.runs).toHaveLength(2);
    expect(r.runs[0].row).toBe(0);
    expect(r.summary).toContain("2/2 行通过");
  });

  it("data 行缺变量时该行失败但不中断后续行", async () => {
    const r: any = await replayTool(
      { name: "t-login", data: [{ other: "x" }, { user: "b" }] },
      impls,
    );
    expect(r.runs[0].error).toContain("缺少变量");
    expect(r.runs[0].failed).toBe(2);
    expect(r.passedRows).toBe(1);
    expect(r.failedRows).toBe(1);
  });

  it("replay 直接传 steps 也支持 vars 注入", async () => {
    const r: any = await replayTool(
      { steps: [{ tool: "noop", args: { v: "{{n}}" } }], vars: { n: 42 } },
      impls,
    );
    expect(r.passed).toBe(1);
  });
});
