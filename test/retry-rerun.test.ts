// F2 失败自动重跑(retryFailed)与面板一键重跑(rerun)测试。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReplay, runPanelRerun, setRerunHandler, getRerunHandler, replayTool } from "../src/browser/tools.js";
import { noteToolStart, noteToolEnd, activeToolCalls } from "../src/browser/session.js";
import { listRuns } from "../src/browser/reports.js";
import type { ReplayStep } from "../src/browser/types.js";

// runs.jsonl 落盘隔离:测试期间指向临时目录。
const tmpHome = mkdtempSync(join(tmpdir(), "dsh-browser-retry-"));
const origHome = process.env.DSH_HOME;
process.env.DSH_HOME = tmpHome;
afterAll(() => {
  process.env.DSH_HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

/** 偶发失败实现:前 failTimes 次抛错,之后成功(模拟网络延迟导致的偶发超时)。 */
function flakyImpl(failTimes: number, tag = "flaky") {
  let calls = 0;
  const impl = async (args: any) => {
    calls++;
    if (calls <= failTimes) throw new Error(`${tag} 偶发超时 #${calls}`);
    return { ok: true, selector: args?.selector };
  };
  return { impl, callCount: () => calls };
}

describe("runReplay retryFailed(自动重试)", () => {
  it("偶发失败经 retryFailed:2 挽回:整体通过,retries 标 attempted/recovered,步骤标 recovered", async () => {
    const f = flakyImpl(1); // 第 1 次失败,重试第 1 次即挽回
    const steps: ReplayStep[] = [{ tool: "browser_click", args: { selector: "#a" } }];
    const r = await runReplay(steps, { browser_click: f.impl }, true, { retryFailed: 2 });
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.retries).toEqual({ attempted: 1, recovered: 1 });
    expect(r.results[0]).toMatchObject({ ok: true, recovered: true });
    expect(f.callCount()).toBe(2);
    expect(r.stoppedAt).toBeUndefined();
  });

  it("重试耗尽仍失败:该步失败且 failFast 停止(重试耗尽才停)", async () => {
    const f = flakyImpl(99); // 永远失败
    const steps: ReplayStep[] = [
      { tool: "browser_click", args: { selector: "#a" } },
      { tool: "browser_click", args: { selector: "#b" } },
    ];
    const r = await runReplay(steps, { browser_click: f.impl }, true, { retryFailed: 2 });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(r.passed).toBe(0);
    expect(r.stoppedAt).toBe(0); // 重试耗尽后按 failFast 停在第 0 步
    expect(r.retries).toEqual({ attempted: 2, recovered: 0 });
    expect(f.callCount()).toBe(3); // 初次 + 2 次重试
    expect(r.results[0].error).toContain("偶发超时");
  });

  it("failFast=false 时失败不中断后续步骤(重试只作用于失败步骤)", async () => {
    const f = flakyImpl(99);
    const ok = async () => undefined;
    const steps: ReplayStep[] = [
      { tool: "browser_click", args: { selector: "#a" } },
      { tool: "browser_type", args: { selector: "#b", text: "x" } },
    ];
    const r = await runReplay(
      steps,
      { browser_click: f.impl, browser_type: ok },
      false,
      { retryFailed: 1 },
    );
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.results[1].ok).toBe(true); // 后续步骤照常执行
  });

  it("不传 retryFailed 时结果结构与既有语义一致(无 retries 字段)", async () => {
    const f = flakyImpl(1);
    const r = await runReplay([{ tool: "browser_click", args: { selector: "#a" } }], { browser_click: f.impl }, true);
    expect(r.retries).toBeUndefined();
    expect(r.failed).toBe(1);
    expect(r.stoppedAt).toBe(0);
  });
});

describe("replayTool retryFailed 落运行历史", () => {
  it("retries 与 retryOf 写入 runs.jsonl(只增字段)", async () => {
    const f = flakyImpl(1);
    const impls = { browser_click: f.impl };
    await replayTool(
      { steps: [{ tool: "browser_click", args: { selector: "#a" } }], retryFailed: 2, retryOf: "run-xyz" },
      impls,
      {},
    );
    const last = listRuns(1)[0];
    expect(last.retries).toEqual({ attempted: 1, recovered: 1 });
    expect(last.retryOf).toBe("run-xyz");
    // runs.jsonl 原始行含新字段(导出/报告数据源)
    const raw = readFileSync(join(tmpHome, ".dsh-browser", "reports", "runs.jsonl"), "utf8");
    expect(raw).toContain('"retryOf":"run-xyz"');
    expect(raw).toContain('"recovered":1');
  });
});

describe("面板一键重跑(handler + busy)", () => {
  beforeEach(() => {
    setRerunHandler(null as any);
  });
  afterAll(() => {
    setRerunHandler(null as any);
  });

  it("未注册 handler(纯 web 进程)→ 503", async () => {
    // runPanelRerun 在 handler 为 null 时抛 status:503
    await expect(runPanelRerun({ source: "smoke" })).rejects.toMatchObject({ status: 503 });
  });

  it("注册 handler 后走 replayTool 同路径,收到 source/retryOf", async () => {
    let seen: any = null;
    setRerunHandler(async (req) => {
      seen = req;
      return { source: req.source, total: 1, passed: 1, failed: 0 };
    });
    const result = (await runPanelRerun({ source: "smoke", retryOf: "run-abc" })) as any;
    expect(seen).toEqual({ source: "smoke", retryOf: "run-abc" });
    expect(result.passed).toBe(1);
    expect(getRerunHandler()).toBeDefined();
  });

  it("在途工具计数:noteToolStart/End 配对,activeToolCalls 反映忙碌", () => {
    expect(activeToolCalls()).toBe(0);
    noteToolStart();
    expect(activeToolCalls()).toBe(1);
    noteToolEnd();
    expect(activeToolCalls()).toBe(0);
  });
});
