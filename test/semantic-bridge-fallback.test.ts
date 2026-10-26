// what 语义定位的 __DSH_BRIDGE__ 兜底测试:未命中时 feature-detect 页面桥,
// resolveActionTarget 命中 → 走其 selector 定位并标 viaBridge;无桥/桥抛错/
// shape 不符 → 静默回落原 semanticMiss 错误。stub page.evaluate 按第二参形态
// 分流(对象 = 扫描请求,字符串 = 桥探测)。
import { describe, it, expect, vi } from "vitest";
import { resolveTargetLocator } from "../src/browser/session/target.js";
import type { Page } from "playwright-core";

function makePage(opts: { bridgeHit?: { selector: string } | null; bridgeThrows?: boolean } = {}): Page {
  const bridgeLoc: any = {
    first: () => bridgeLoc,
    count: vi.fn().mockResolvedValue(opts.bridgeHit ? 1 : 0),
  };
  const byRoleLoc: any = {
    first: () => byRoleLoc,
    count: vi.fn().mockResolvedValue(0), // role 兜底全部未命中
  };
  const page: any = {
    evaluate: vi.fn().mockImplementation(async (_fn: unknown, arg: unknown) => {
      if (typeof arg === "string") {
        // 桥探测调用
        if (opts.bridgeThrows === true) throw new Error("bridge exploded");
        return opts.bridgeHit ?? null;
      }
      // 语义扫描调用:零命中
      return { matches: [], candidates: [], scanned: 0 };
    }),
    getByRole: vi.fn().mockReturnValue(byRoleLoc),
    locator: vi.fn().mockReturnValue(bridgeLoc),
  };
  return page as Page;
}

describe("what 定位的 __DSH_BRIDGE__ 兜底", () => {
  it("桥命中:resolveActionTarget 返回 selector → 走正常管线并标 viaBridge", async () => {
    const page = makePage({ bridgeHit: { selector: "#bridge-target" } });
    const res = await resolveTargetLocator(page, { what: "返回上一级" });
    expect(res.viaBridge).toBe(true);
    expect((res as any).matchedCount).toBe(1);
    expect(page.locator).toHaveBeenCalledWith("#bridge-target");
  });

  it("无桥(feature-detect 失败)→ 回落原语义未命中错误", async () => {
    const page = makePage({ bridgeHit: null });
    await expect(resolveTargetLocator(page, { what: "返回上一级" })).rejects.toThrow(/语义定位未命中/);
  });

  it("桥方法抛错 → 静默回落,不放大错误", async () => {
    const page = makePage({ bridgeThrows: true });
    await expect(resolveTargetLocator(page, { what: "返回上一级" })).rejects.toThrow(/语义定位未命中/);
  });

  it("桥返回的 selector 页面无命中 → 回落原错误(不造幻觉定位)", async () => {
    const page = makePage({ bridgeHit: { selector: "#gone" } });
    // bridgeLoc.count 返回 1 由 opts.bridgeHit 决定;此处模拟 selector 失效:
    (page.locator as any).mockImplementation(() => ({ first: () => ({ count: vi.fn().mockResolvedValue(0), first() { return this; } }) }));
    await expect(resolveTargetLocator(page, { what: "返回上一级" })).rejects.toThrow(/语义定位未命中/);
  });
});
