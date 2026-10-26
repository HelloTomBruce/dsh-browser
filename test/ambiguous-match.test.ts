// 多命中歧义可见化测试:click/type/press/select 成功返回透出 matchedCount/
// visibleCount 并在 >1 时附 hint;strict 多命中抛错;type 的 force 降级守卫
// (遮罩拦截不再被抹平)。stub 模式照抄 context.test.ts,locator 按 selector 分流
// (弹窗探测选择器返回 0 命中,目标选择器返回配置的计数)。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clickTool, typeTool, pressTool, selectTool } from "../src/browser/tools.js";
import { currentProfile, getProfileState } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { Locator, Page } from "playwright-core";

const CONFIG: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

interface TargetStub extends Locator {
  __clickCalls: number;
}

function makeTargetStub(total: number, visible: number, opts: { failFirstClick?: boolean } = {}): TargetStub {
  let clickCalls = 0;
  const clickImpl = async () => {
    clickCalls += 1;
    if (opts.failFirstClick === true && clickCalls === 1) throw new Error("element is covered by another element");
    return undefined;
  };
  const vis: any = {
    count: vi.fn().mockResolvedValue(visible),
    first: () => vis,
    locator: () => vis,
    click: vi.fn().mockImplementation(clickImpl),
    press: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(false),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const base: any = {
    count: vi.fn().mockResolvedValue(total),
    first: () => (visible > 0 ? vis : base),
    last: () => base,
    locator: (sub: string) => (sub === "visible=true" ? vis : base),
    click: vi.fn().mockImplementation(clickImpl),
    press: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(false),
    isVisible: vi.fn().mockResolvedValue(true),
    waitFor: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(base, "__clickCalls", { get: () => clickCalls });
  Object.defineProperty(vis, "__clickCalls", { get: () => clickCalls });
  return base as TargetStub;
}

function makeFakePage(targetStub: TargetStub): Page {
  const dialogStub: any = {
    count: vi.fn().mockResolvedValue(0),
    first: () => dialogStub,
    last: () => dialogStub,
    locator: () => dialogStub,
  };
  const page: any = {
    url: () => "https://app.example/form",
    title: async () => "表单页",
    setDefaultTimeout: () => {},
    on: () => {},
    isClosed: () => false,
    exposeBinding: async () => {},
    addInitScript: async () => {},
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    keyboard: { type: vi.fn(), press: vi.fn() },
    locator: (sel: unknown) => {
      const s = Array.isArray(sel) ? sel.join(",") : String(sel);
      return s.includes("dialog") || s.includes("alert") ? dialogStub : targetStub;
    },
  };
  return page as Page;
}

function install(page: Page) {
  const state = getProfileState(currentProfile);
  state.browser = { newPage: async () => page, close: async () => {} } as any;
  state.context = null;
  state.pages = new Map([[0, page]]);
  state.tabMeta = new Map([[0, { createdAt: Date.now() }]]);
  state.activeId = 0;
}

beforeEach(() => {
  const state = getProfileState(currentProfile);
  state.pages = new Map();
  state.tabMeta?.clear();
  state.activeId = null;
  state.counter = 0;
  state.browser = null;
  state.context = null;
});

describe("多命中歧义可见化", () => {
  it("click 单命中:返回 matchedCount=1,无 hint", async () => {
    const stub = makeTargetStub(1, 1);
    install(makeFakePage(stub));
    const r = (await clickTool(CONFIG, { selector: "#unique" })) as any;
    expect(r.matchedCount).toBe(1);
    expect(r.visibleCount).toBe(1);
    expect(r.hint).toBeUndefined();
  });

  it("click 多命中(背景表单+Modal 同名字段):matchedCount/visibleCount/hint 齐全", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    const r = (await clickTool(CONFIG, { selector: "[data-dsh-field='ruleName']" })) as any;
    expect(r.matchedCount).toBe(2);
    expect(r.visibleCount).toBe(1);
    expect(r.hint).toContain("命中 2 个元素");
    expect(r.hint).toContain("已操作第 1 个");
  });

  it("click strict 多命中 → 抛错要求消歧", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    await expect(clickTool(CONFIG, { selector: "#dup", strict: true })).rejects.toThrow(/strict 模式拒绝多命中.*2 个元素/s);
  });

  it("type 多命中:返回字段齐全,正常点击(非 force 直达)", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    const r = (await typeTool(CONFIG, { selector: "[data-dsh-field='ruleName']", text: "hello" })) as any;
    expect(r.typed).toBe(true);
    expect(r.matchedCount).toBe(2);
    expect(r.hint).toContain("命中 2 个元素");
    expect(stub.__clickCalls).toBe(1);
  });

  it("type 多命中且首个被遮挡:中止而非 force 抹平(实战 Modal 背景输入框场景)", async () => {
    const stub = makeTargetStub(2, 2, { failFirstClick: true });
    install(makeFakePage(stub));
    await expect(typeTool(CONFIG, { selector: "#dup", text: "x" })).rejects.toThrow(/存在歧义.*已中止/);
    expect(stub.__clickCalls).toBe(1); // 没有 force 第二次
  });

  it("type 单命中首个被遮挡:保留旧 force 降级行为", async () => {
    const stub = makeTargetStub(1, 1, { failFirstClick: true });
    install(makeFakePage(stub));
    const r = (await typeTool(CONFIG, { selector: "#solo", text: "x" })) as any;
    expect(r.typed).toBe(true);
    expect(stub.__clickCalls).toBe(2); // force 重试了一次
  });

  it("type strict 多命中 → 抛错", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    await expect(typeTool(CONFIG, { selector: "#dup", text: "x", strict: true })).rejects.toThrow(
      /strict 模式拒绝多命中/,
    );
  });

  it("press 多命中:返回 matchedCount", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    const r = (await pressTool(CONFIG, { key: "Enter", selector: "#dup" })) as any;
    expect(r.pressed).toBe("Enter");
    expect(r.matchedCount).toBe(2);
    expect(r.hint).toContain("命中 2 个元素");
  });

  it("select strict 多命中 → 抛错(早于下拉适配器执行)", async () => {
    const stub = makeTargetStub(2, 1);
    install(makeFakePage(stub));
    await expect(selectTool(CONFIG, { selector: "#dup", option: "A", strict: true })).rejects.toThrow(
      /strict 模式拒绝多命中/,
    );
  });
});
