import { describe, it, expect } from "vitest";
import { runReplay } from "../src/browser/tools.js";

const impls = {
  a: async () => ({ ok: true }),
  b: async () => {
    throw new Error("b boom");
  },
  c: async () => ({ ok: true }),
};

describe("runReplay", () => {
  it("全部通过时统计正确", async () => {
    const r = await runReplay([{ tool: "a", args: {} }, { tool: "c", args: {} }], impls, true);
    expect(r).toMatchObject({ total: 2, passed: 2, failed: 0, stoppedAt: null });
    expect(r.results.every((x) => x.ok)).toBe(true);
  });

  it("failFast 遇错即停并标记停止位置", async () => {
    const r = await runReplay(
      [{ tool: "a", args: {} }, { tool: "b", args: {} }, { tool: "c", args: {} }],
      impls,
      true,
    );
    expect(r).toMatchObject({ total: 3, passed: 1, failed: 1, stoppedAt: 1 });
    expect(r.results[1].error).toContain("b boom");
  });

  it("failFast=false 时继续执行后续步骤", async () => {
    const r = await runReplay(
      [{ tool: "a", args: {} }, { tool: "b", args: {} }, { tool: "c", args: {} }],
      impls,
      false,
    );
    expect(r).toMatchObject({ total: 3, passed: 2, failed: 1, stoppedAt: null });
  });

  it("未知工具记录为失败", async () => {
    const r = await runReplay([{ tool: "nope", args: {} }], impls, true);
    expect(r.results[0].error).toContain("未知步骤工具");
    expect(r.failed).toBe(1);
  });

  it("空步骤返回零统计", async () => {
    const r = await runReplay([], impls, true);
    expect(r).toMatchObject({ total: 0, passed: 0, failed: 0, stoppedAt: null });
  });
});
