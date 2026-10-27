// M2 视觉定位通道测试:SoM mark 点击分支、ref 坐标兜底、SoM 失败契约。
// 页内注入(rect 收集/elementFromPoint)依赖浏览器,不在单测范围。
import { describe, expect, it, vi } from "vitest";
import { resolveTargetLocator } from "../src/browser/session/target.js";
import { setPageMarks, setPageRefs, pageMark } from "../src/browser/session/cache.js";
import { somFallbackShot } from "../src/browser/tools/inspection.js";
import { clickTool } from "../src/browser/tools/interaction.js";
import type { Page } from "playwright-core";

describe("mark 定位分支 (SoM 标徽)", () => {
  it("已注册的 mark 按 selector 定位", async () => {
    const locMock: any = { first: () => locMock, count: vi.fn().mockResolvedValue(1) };
    const page: any = { locator: vi.fn().mockReturnValue(locMock) } as unknown as Page;
    setPageMarks(page, new Map([[3, { role: "button", name: "登录", selector: "#login" }]]));
    const res = await resolveTargetLocator(page, { mark: 3 });
    expect(res.locator).toBe(locMock);
    expect(page.locator).toHaveBeenCalledWith("#login");
  });

  it("未知 mark 抛指引性错误", async () => {
    const page: any = { locator: vi.fn() } as unknown as Page;
    setPageMarks(page, new Map());
    await expect(resolveTargetLocator(page, { mark: 9 })).rejects.toThrow("未知 mark: 9");
  });

  it("mark 与 selector 同时传 → 互斥硬校验报错(不再静默按 selector 择一)", async () => {
    const locMock: any = { first: () => locMock };
    const page: any = { locator: vi.fn().mockReturnValue(locMock) } as unknown as Page;
    setPageMarks(page, new Map([[1, { role: "button", name: "x", selector: "#m" }]]));
    await expect(resolveTargetLocator(page, { mark: 1, selector: "#s" })).rejects.toThrow(/定位参数冲突/);
    expect(page.locator).not.toHaveBeenCalled();
  });

  it("mark 路径失效时降级 getByRole", async () => {
    const pathLoc: any = { first: () => pathLoc, count: vi.fn().mockResolvedValue(0) };
    const roleLoc: any = { first: () => roleLoc, count: vi.fn().mockResolvedValue(1) };
    const page: any = {
      locator: vi.fn().mockReturnValue(pathLoc),
      getByRole: vi.fn().mockReturnValue(roleLoc),
    } as unknown as Page;
    setPageMarks(page, new Map([[2, { role: "button", name: "确 定", selector: "#gone" }]]));
    const res = await resolveTargetLocator(page, { mark: 2 });
    expect(res.locator).toBe(roleLoc);
    expect(page.getByRole).toHaveBeenCalledWith("button", expect.objectContaining({ name: expect.any(RegExp) }));
  });

  it("mark 全链路失效抛错", async () => {
    const pathLoc: any = { first: () => pathLoc, count: vi.fn().mockResolvedValue(0) };
    const roleLoc: any = { first: () => roleLoc, count: vi.fn().mockResolvedValue(0) };
    const page: any = {
      locator: vi.fn().mockReturnValue(pathLoc),
      getByRole: vi.fn().mockReturnValue(roleLoc),
    } as unknown as Page;
    setPageMarks(page, new Map([[5, { role: "button", name: "提交", selector: "#gone" }]]));
    await expect(resolveTargetLocator(page, { mark: 5 })).rejects.toThrow("mark 5 已失效");
  });
});

describe("ref 坐标兜底 (降级 3)", () => {
  function coordPage(evaluateResult: any) {
    // 路径防漂移校验(locator.evaluate)失败 → 弹窗降级无 getByRole → role 降级
    // count=0 → 坐标探测(page.evaluate)返回 evaluateResult
    const locMock: any = {
      first: () => locMock,
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue(false), // 路径校验不通过
    };
    const page: any = {
      locator: vi.fn().mockReturnValue(locMock),
      evaluate: vi.fn().mockResolvedValue(evaluateResult),
      getByRole: vi.fn().mockReturnValue({ first: () => ({ count: vi.fn().mockResolvedValue(0) }) }),
    };
    return { page, locMock };
  }

  it("role/name 相似的命中点返回其 selector 定位", async () => {
    const { page, locMock } = coordPage({ selector: "#rebound", role: "button", name: "登录" });
    setPageRefs(page, new Map([
      ["e1", { role: "button", name: "登录", selector: "#broken", rect: { x: 100, y: 200, w: 60, h: 30 }, scroll: { x: 0, y: 0 } }],
    ]));
    const res = await resolveTargetLocator(page, { ref: "e1" });
    expect(res.locator).toBe(locMock);
    expect(page.locator).toHaveBeenLastCalledWith("#rebound");
    // 坐标探测 1 + 活动弹窗仲裁 1(未发版;stub locator count=1 → 并集快探命中进入仲裁)
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it("role 不相似不兜底(维持 ref 已失效错误)", async () => {
    const { page } = coordPage({ selector: "#other", role: "link", name: "完全无关" });
    setPageRefs(page, new Map([
      ["e1", { role: "button", name: "登录", selector: "#broken", rect: { x: 100, y: 200, w: 60, h: 30 }, scroll: { x: 0, y: 0 } }],
    ]));
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("ref e1 已失效");
  });

  it("无 rect 的旧 ref 不触发坐标兜底(page.evaluate 零调用)", async () => {
    const locMock: any = { first: () => locMock, count: vi.fn().mockResolvedValue(1), evaluate: vi.fn().mockResolvedValue(false) };
    const roleLoc: any = { first: () => roleLoc, count: vi.fn().mockResolvedValue(0) };
    const page: any = {
      locator: vi.fn().mockReturnValue(locMock),
      evaluate: vi.fn(),
      getByRole: vi.fn().mockReturnValue(roleLoc),
    };
    setPageRefs(page, new Map([["e1", { role: "button", name: "登录", selector: "#x" }]]));
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("ref e1 已失效");
    // evaluate = 失败遥测探测 1 + 活动弹窗仲裁 1(未发版弹窗仲裁新增;stub locator count=1
    // → 并集快探命中进入仲裁;非坐标兜底/重锚定扫描)
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});

describe("SoM 失败契约", () => {
  it("somFallbackShot 无活动页面时返回 null(不放大错误)", async () => {
    const out = await somFallbackShot({ timeoutMs: 1000 } as any);
    expect(out).toBeNull();
  });

  it("clickTool 语义零命中错误保留 semanticMiss 标记(somFallback 关闭不附加截图)", async () => {
    vi.mock("../src/browser/session.js", async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, getPage: vi.fn() };
    });
    const session = await import("../src/browser/session.js");
    const byRoleLoc: any = { first: () => byRoleLoc, count: vi.fn().mockResolvedValue(0) };
    const page: any = {
      evaluate: vi.fn().mockResolvedValue({ matches: [], candidates: [{ role: "button", name: "提交订单", selector: "#a" }], scanned: 1 }),
      getByRole: vi.fn().mockReturnValue(byRoleLoc),
      locator: vi.fn(),
    };
    (session as any).getPage.mockResolvedValue(page);
    try {
      await clickTool({ timeoutMs: 1000, somFallback: false } as any, { what: "提交订单" });
      expect.unreachable("应抛错");
    } catch (e: any) {
      expect(e.message).toContain('what="提交订单"');
      expect(e.message).toContain('button "提交订单"'); // 候选表内嵌
      expect(e.semanticMiss).toBeDefined();
      expect(e.vlm).toBeUndefined(); // somFallback 关闭不附截图
    }
  });
});

describe("mark 注册表生命周期", () => {
  it("setPageMarks/pageMark 基础读写", () => {
    const page: any = {};
    setPageMarks(page, new Map([[1, { role: "button", name: "a", selector: "#a" }]]));
    expect(pageMark(page, 1)?.selector).toBe("#a");
    expect(pageMark(page, 2)).toBeUndefined();
  });
});
