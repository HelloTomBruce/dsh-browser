// F1 confirm 自动拦截(confirmMode: "auto")纯逻辑与闸门行为测试。
// 闸门用注入的假 page(只实现 evaluate)驱动,不依赖真实浏览器;
// 审批决策通过 session 的 setPendingConfirm/resolveConfirm 管线真实走一遍。
import { describe, it, expect, afterEach } from "vitest";
import {
  sensitiveHits, confirmGate, DEFAULT_SENSITIVE_PATTERNS, DEFAULT_SENSITIVE_TOOLS,
} from "../src/browser/tools.js";
import { getPendingConfirm, clearPendingConfirm } from "../src/browser/session.js";
import type { SensitiveDesc } from "../src/browser/tools.js";

afterEach(() => {
  clearPendingConfirm();
});

function desc(partial: Partial<SensitiveDesc>): SensitiveDesc {
  return { role: "", name: "", text: "", id: "", testid: "", tag: "button", ...partial };
}

/** 假 page:evaluate 直接返回预置的元素描述(模拟页内 describeTarget)。 */
function fakePage(d: SensitiveDesc | null) {
  return {
    evaluate: async (_fn: unknown, _sel: string) => d,
    // confirmGate 只用到 evaluate;其余成员按需补
  } as any;
}

/** 等审批卡出现并点「允许」。 */
async function approveWhenPending() {
  for (let i = 0; i < 100; i++) {
    const pending = getPendingConfirm();
    if (pending !== null) {
      if (!pending.decision) {
        (pending as any).decision = "allowed";
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("审批卡未出现");
}

describe("sensitiveHits(纯逻辑匹配)", () => {
  it("默认模式命中 name/text/id/testid/role 任一字段", () => {
    expect(sensitiveHits(desc({ name: "删除用户" }), DEFAULT_SENSITIVE_PATTERNS)).toEqual(["删除"]);
    expect(sensitiveHits(desc({ text: "确认支付订单" }), DEFAULT_SENSITIVE_PATTERNS)).toEqual(["支付"]);
    expect(sensitiveHits(desc({ id: "submit-btn" }), ["submit"])).toEqual(["submit"]);
    expect(sensitiveHits(desc({ testid: "pay-button" }), ["pay"])).toEqual(["pay"]);
    expect(sensitiveHits(desc({ role: "删除" }), ["删除"])).toEqual(["删除"]);
  });

  it("大小写不敏感;空白/空模式忽略;元素不存在(null)不命中", () => {
    expect(sensitiveHits(desc({ name: "DELETE ALL" }), ["delete"])).toEqual(["delete"]);
    expect(sensitiveHits(desc({ name: "提交" }), ["  ", ""])).toEqual([]);
    expect(sensitiveHits(null, DEFAULT_SENSITIVE_PATTERNS)).toEqual([]);
  });

  it("非敏感内容零命中(翻页/展开下拉等不误伤)", () => {
    expect(sensitiveHits(desc({ name: "下一页", text: "展开更多" }), DEFAULT_SENSITIVE_PATTERNS)).toEqual([]);
  });

  it("默认只拦 browser_click", () => {
    expect(DEFAULT_SENSITIVE_TOOLS).toEqual(["browser_click"]);
  });
});

describe("confirmGate(闸门行为)", () => {
  const baseConfig = { confirmMode: "auto" as const, confirmTimeoutMs: 60_000 };

  it("非 auto 模式直接放行(manual/off 与 v0.3 零差异)", async () => {
    const page = fakePage(desc({ name: "删除全部数据" }));
    // 不应抛错、不应产生审批卡
    await confirmGate({ ...baseConfig, confirmMode: "manual" }, "browser_click", { selector: "#del" }, page);
    await confirmGate({ ...baseConfig, confirmMode: "off" }, "browser_click", { selector: "#del" }, page);
    expect(getPendingConfirm()).toBeNull();
  });

  it("工具不在 sensitiveTools / 模式为空 / 无 selector 时放行", async () => {
    const page = fakePage(desc({ name: "删除" }));
    await confirmGate(baseConfig, "browser_type", { selector: "#del" }, page); // 默认只拦 click
    await confirmGate({ ...baseConfig, sensitivePatterns: [] }, "browser_click", { selector: "#del" }, page);
    await confirmGate(baseConfig, "browser_click", {}, page); // 无 selector/ref
    expect(getPendingConfirm()).toBeNull();
  });

  it("auto + 命中敏感模式 → 弹审批卡,允许后放行", async () => {
    const page = fakePage(desc({ role: "button", name: "删除用户", tag: "button" }));
    const p = confirmGate(baseConfig, "browser_click", { selector: "#del" }, page);
    await approveWhenPending();
    await p; // 允许:不抛错
    expect(getPendingConfirm()).toBeNull(); // 审批卡已清理
  });

  it("auto + 命中 + 拒绝 → 抛错(该步失败),reason 含命中模式与元素信息", async () => {
    const page = fakePage(desc({ role: "button", name: "支付订单", tag: "button" }));
    const p = confirmGate(baseConfig, "browser_click", { selector: "#pay" }, page);
    const pending = await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (getPendingConfirm() !== null) {
          clearInterval(t);
          resolve();
        }
      }, 20);
    });
    void pending;
    const entry = getPendingConfirm()!;
    (entry as any).decision = "denied";
    await expect(p).rejects.toThrow(/敏感操作被拒绝.*支付/);
  });

  it("页内取描述失败(导航中/页面不可达)放行,由原工具自行报错", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("execution context destroyed");
      },
    } as any;
    await confirmGate(baseConfig, "browser_click", { selector: "#del" }, page);
    expect(getPendingConfirm()).toBeNull();
  });
});
