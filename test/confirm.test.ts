// browser_confirm 单元测试:不依赖浏览器,通过 session 的 pendingConfirm
// 状态直接注入决策。覆盖:缺参数、用户允许、用户拒绝、超时 fail-closed、
// id 不匹配(被取代)、决策后状态清理。
import { describe, it, expect, afterEach } from "vitest";
import { confirmTool } from "../src/browser/tools.js";
import { getPendingConfirm, clearPendingConfirm, setPendingConfirm } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";

const CONFIG: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

afterEach(() => {
  clearPendingConfirm();
});

/** 启动 confirm,等到 pending 出现后注入决策,返回工具结果。 */
async function confirmWithDecision(
  args: Record<string, any>,
  decision: "allowed" | "denied",
): Promise<unknown> {
  const p = confirmTool(CONFIG, args);
  // 等 pending 挂上(轮询 500ms 一步,给足余量)
  const deadline = Date.now() + 3000;
  while (getPendingConfirm() === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const pending = getPendingConfirm();
  if (pending === null) throw new Error("pending confirm 未出现");
  expect(resolve(pending.id, decision)).toBe(true);
  return p;
}

// 直接引用 session 的 resolveConfirm(避免与工具实现共用同一 import 路径差异)
import { resolveConfirm as resolve } from "../src/browser/session.js";

describe("confirmTool", () => {
  it("缺少 reason 直接报错", async () => {
    await expect(confirmTool(CONFIG, {})).rejects.toThrow("reason");
    await expect(confirmTool(CONFIG, { reason: "  " })).rejects.toThrow("reason");
    expect(getPendingConfirm()).toBeNull();
  });

  it("用户允许:返回 decision=allowed 并清理状态", async () => {
    const result = (await confirmWithDecision({ reason: "提交表单" }, "allowed")) as any;
    expect(result.decision).toBe("allowed");
    expect(result.detail).toContain("用户允许");
    expect(typeof result.id).toBe("string");
    expect(typeof result.waitedMs).toBe("number");
    expect(getPendingConfirm()).toBeNull();
  });

  it("用户拒绝:抛错且消息含 reason 与拒绝说明", async () => {
    await expect(confirmWithDecision({ reason: "删除记录" }, "denied")).rejects.toThrow(
      /敏感操作被拒绝: 删除记录/,
    );
    expect(getPendingConfirm()).toBeNull();
  });

  it("超时 fail-closed:按拒绝抛错", async () => {
    await expect(
      confirmTool(CONFIG, { reason: "支付订单", timeoutMs: 1_000 }),
    ).rejects.toThrow(/敏感操作被拒绝: 支付订单.*超时/);
    expect(getPendingConfirm()).toBeNull();
  });

  it("审批被新请求取代时按拒绝处理,且不动新请求", async () => {
    const p = confirmTool(CONFIG, { reason: "旧请求", timeoutMs: 5_000 });
    const deadline = Date.now() + 3000;
    while (getPendingConfirm() === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const oldId = getPendingConfirm()!.id;
    // 模拟被新的审批取代(直接覆盖 pending)
    setPendingConfirm({ id: "cfm-new", reason: "新请求", startedAt: Date.now() });
    await expect(p).rejects.toThrow(/已被新的审批取代/);
    // 新请求不被清理
    expect(getPendingConfirm()?.id).toBe("cfm-new");
  });

  it("resolveConfirm 用错 id 返回 false(不影响原请求)", async () => {
    const p = confirmTool(CONFIG, { reason: "提交", timeoutMs: 1_500 });
    const deadline = Date.now() + 3000;
    while (getPendingConfirm() === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(resolve("cfm-wrong-id", "allowed")).toBe(false);
    expect(getPendingConfirm()?.decision).toBeUndefined();
    await expect(p).rejects.toThrow(/超时/);
  });
});
