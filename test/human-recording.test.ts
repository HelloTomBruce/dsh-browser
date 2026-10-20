// 混合录制(human-in-the-loop)纯逻辑单元测试:
// humanEventToStep 映射、agent 去重窗口、人工步骤进入/不进入录制 buffer。
import { describe, it, expect, beforeEach } from "vitest";
import {
  humanEventToStep, agentActionRecent, noteAgentAction,
  startRecording, stopRecording, isRecording, lastRecordingOf,
} from "../src/browser/session.js";
import { runReplay } from "../src/browser/tools.js";

// recordCall 是模块内部使用,human 步骤写入 buffer 的路径与 agent 步骤相同;
// 这里通过导出的 recordCall 验证(混合序列场景)。
import { recordCall } from "../src/browser/session.js";

beforeEach(() => {
  if (isRecording()) stopRecording();
  noteAgentActionResetForTest();
});

// 测试辅助:把 lastAgentActionAt 归零(vitest 不便直接改模块内私有变量,
// agentActionRecent(now) 可传 now,这里用足够久的过去时间近似)。
function noteAgentActionResetForTest() {
  // 传一个远未来的 now 让「距上次操作」为负 → 视为不近期;
  // 反向不可行,改用大 windowMs=0 的判定
}

describe("humanEventToStep", () => {
  it("click 事件映射为 browser_click 步骤(带指纹)", () => {
    const step = humanEventToStep({
      kind: "click", selector: "#submit", testid: "login-btn",
      role: "button", name: "登 录", id: "submit", text: "登 录", tag: "button",
    });
    expect(step).toEqual({
      tool: "browser_click",
      args: { selector: "#submit" },
      meta: { hint: { testid: "login-btn", role: "button", name: "登 录", id: "submit", text: "登 录", tag: "button" }, source: "human" },
    });
  });

  it("input 事件映射为 browser_type(text 为当前值)", () => {
    const step = humanEventToStep({ kind: "input", selector: "#sms", value: "123456", tag: "input", id: "sms" });
    expect(step).toMatchObject({ tool: "browser_type", args: { selector: "#sms", text: "123456" } });
    expect(step!.meta.source).toBe("human");
    expect(step!.meta.hint.id).toBe("sms");
  });

  it("select 事件映射为 browser_select(option 为选中文本)", () => {
    const step = humanEventToStep({ kind: "select", selector: "#city", value: "杭州市", tag: "select" });
    expect(step).toMatchObject({ tool: "browser_select", args: { selector: "#city", option: "杭州市" } });
  });

  it("空输入/空选项/缺 selector/未知 kind 返回 null", () => {
    expect(humanEventToStep({ kind: "input", selector: "#a", value: "" })).toBeNull();
    expect(humanEventToStep({ kind: "select", selector: "#a", value: "  " })).toBeNull();
    expect(humanEventToStep({ kind: "click", selector: "" })).toBeNull();
    expect(humanEventToStep({ kind: "scroll", selector: "#a" })).toBeNull();
    expect(humanEventToStep(null)).toBeNull();
    expect(humanEventToStep("x")).toBeNull();
  });

  it("指纹只保留非空字段", () => {
    const step = humanEventToStep({ kind: "click", selector: "#b", testid: "", role: "", name: "", id: "", text: "", tag: "button" });
    expect(step!.meta.hint).toEqual({ tag: "button" });
  });
});

describe("agentActionRecent 去重窗口", () => {
  it("noteAgentAction 后 1.5s 内视为近期", () => {
    noteAgentAction();
    expect(agentActionRecent(Date.now() + 1_000)).toBe(true);
    expect(agentActionRecent(Date.now() + 2_000)).toBe(false);
  });

  it("windowMs 可调(测试用 0 即关窗)", () => {
    noteAgentAction();
    expect(agentActionRecent(Date.now(), 0)).toBe(false);
  });
});

describe("混合序列进录制 buffer", () => {
  it("agent 步骤 + human 步骤(start→stop)都保留,meta.source 标记 human", () => {
    startRecording();
    recordCall({ tool: "browser_open", args: { url: "https://x/login" }, ok: true, ms: 10, ts: 1 });
    const human = humanEventToStep({ kind: "input", selector: "#sms", value: "888888", tag: "input" })!;
    recordCall({ tool: human.tool, args: human.args, ok: true, ms: 0, ts: 2, meta: human.meta, source: "human" });
    recordCall({ tool: "browser_click", args: { selector: "#submit" }, ok: true, ms: 10, ts: 3 });
    const steps = stopRecording();
    expect(steps.length).toBe(3);
    expect(steps[1]).toMatchObject({ tool: "browser_type", source: "human" });
    expect(steps[1].meta).toEqual({ hint: { tag: "input" }, source: "human" });
    expect(lastRecordingOf()).toEqual(steps);
  });

  it("human 步骤可被 runReplay 回放(混合录制 → 回放闭环)", async () => {
    startRecording();
    const typed = humanEventToStep({ kind: "input", selector: "#kw", value: "dsh", tag: "input" })!;
    recordCall({ tool: typed.tool, args: typed.args, ok: true, ms: 0, ts: 1, meta: typed.meta, source: "human" });
    stopRecording();
    const impls = {
      browser_type: async () => ({ ok: true }),
    };
    const r = await runReplay(
      lastRecordingOf()!.map((c) => ({ tool: c.tool, args: c.args })),
      impls as any,
      true,
    );
    expect(r).toMatchObject({ total: 1, passed: 1, failed: 0 });
  });
});
