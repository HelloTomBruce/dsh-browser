// M6 点击效果验证与定位失败遥测测试:collectChangeDigest 容错、clickTool
// effect 编排(动静摘要/URL 变化/新请求/无动静提示)、tracer 透出。
// 注:vi.mock 提升后同文件只有一个 factory 生效,各用例通过 mockState 切换行为。
import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";

const mockState = vi.hoisted(() => {
  // vi 在 hoisted 工厂里不可直接引用,但 vi.fn 是普通函数:借助全局异步导入不可行,
  // 改用极简手写 stub(测试内按需覆写行为,断言不依赖 vi 内部能力)。
  const fn = (impl?: (...a: any[]) => any) => {
    let current = impl;
    const f: any = (...args: any[]) => current?.(...args);
    f.mockImplementation = (i: any) => {
      current = i;
      return f;
    };
    f.mockReturnValue = (v: any) => {
      current = () => v;
      return f;
    };
    f.mockResolvedValue = (v: any) => {
      current = () => Promise.resolve(v);
      return f;
    };
    return f;
  };
  return {
    getPage: fn(),
    networkEntries: fn(() => []),
    currentProfile: "effect-test",
  };
});

vi.mock("../src/browser/session.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, ...mockState };
});

import { collectChangeDigest } from "../src/browser/primitives/dom.js";
import { clickTool } from "../src/browser/tools/interaction.js";
import { sessionTracer } from "../src/browser/session/tracer.js";

describe("collectChangeDigest 容错", () => {
  it("evaluate 失败返回空摘要(不放大错误)", async () => {
    const page: any = { evaluate: vi.fn().mockRejectedValue(new Error("nav")) };
    const out = await collectChangeDigest(page as unknown as Page, { windowMs: 100 });
    expect(out).toEqual({ mutations: [], domChanged: false });
  });

  it("窗口参数钳制(100ms..3000ms / 1..30 条)不抛错", async () => {
    const page: any = { evaluate: vi.fn().mockResolvedValue({ mutations: ["+ #a"], domChanged: true }) };
    const out = await collectChangeDigest(page as unknown as Page, { windowMs: 99999, maxItems: 999 });
    expect(out.domChanged).toBe(true);
  });
});

function effectClickPage(digest: { mutations: string[]; domChanged: boolean }) {
  const target: any = {
    first: () => target,
    count: vi.fn().mockResolvedValue(1),
    evaluate: vi.fn().mockResolvedValue(false),
    click: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
  };
  const page: any = {
    locator: vi.fn().mockReturnValue(target),
    evaluate: vi.fn().mockResolvedValue(digest),
    url: vi.fn().mockReturnValue("https://example.com/page"),
    title: vi.fn().mockResolvedValue("示例"),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
  };
  return { page, target };
}

describe("clickTool effect 验证", () => {
  it("有 DOM 动静:返回 effect 摘要,无 effectHint", async () => {
    mockState.networkEntries.mockReturnValue([]);
    const { page } = effectClickPage({ mutations: ["+ #modal"], domChanged: true });
    mockState.getPage.mockResolvedValue(page);
    const res: any = await clickTool({ timeoutMs: 1000 } as any, { selector: "#btn", effect: true });
    expect(res.effect).toMatchObject({ domChanged: true, mutations: ["+ #modal"], urlChanged: false });
    expect(res.effectHint).toBeUndefined();
  });

  it("完全无动静:附 effectHint 提示可能未生效", async () => {
    mockState.networkEntries.mockReturnValue([]);
    const { page } = effectClickPage({ mutations: [], domChanged: false });
    mockState.getPage.mockResolvedValue(page);
    const res: any = await clickTool({ timeoutMs: 1000 } as any, { selector: "#btn", effect: true });
    expect(res.effect.domChanged).toBe(false);
    expect(res.effectHint).toContain("未观察到任何");
  });

  it("点击后新增网络请求进入 effect.newRequests(按时间过滤)", async () => {
    mockState.networkEntries.mockImplementation(() => [
      { url: "https://api/old", method: "GET", startedAt: 0, status: 200 },
      { url: "https://api/new", method: "POST", startedAt: Date.now() + 60_000, status: 201 },
    ]);
    const { page } = effectClickPage({ mutations: [], domChanged: false });
    mockState.getPage.mockResolvedValue(page);
    const res: any = await clickTool({ timeoutMs: 1000 } as any, { selector: "#btn", effect: true });
    expect(res.effect.newRequests).toEqual([{ url: "https://api/new", method: "POST", status: 201 }]);
  });

  it("URL 变化计为动静之一(无 DOM 变化也无 hint)", async () => {
    mockState.networkEntries.mockReturnValue([]);
    const { page } = effectClickPage({ mutations: [], domChanged: false });
    let urlIdx = 0;
    page.url = vi.fn().mockImplementation(() => {
      urlIdx += 1;
      return urlIdx === 1 ? "https://example.com/a" : "https://example.com/b";
    });
    mockState.getPage.mockResolvedValue(page);
    const res: any = await clickTool({ timeoutMs: 1000 } as any, { selector: "#btn", effect: true });
    expect(res.effect.urlChanged).toBe(true);
    expect(res.effectHint).toBeUndefined();
  });
});

describe("tracer 定位失败遥测", () => {
  it("endStep 附带 locationFailure 并出现在 traces", async () => {
    const profile = "telemetry-test";
    sessionTracer.startStep(profile, "browser_click", { selector: "#x" }, null);
    await sessionTracer.endStep(
      profile,
      false,
      "click 失败",
      null,
      { phase: "zeroMatch", candidates: 3, dialogActive: true, hasShadow: true },
    );
    const traces = sessionTracer.getTraces(profile);
    const last = traces[traces.length - 1] as any;
    expect(last.locationFailure).toEqual({ phase: "zeroMatch", candidates: 3, dialogActive: true, hasShadow: true });
    sessionTracer.clear(profile);
  });

  it("无 locationFailure 时条目保持原状(向后兼容)", async () => {
    const profile = "telemetry-test-2";
    sessionTracer.startStep(profile, "browser_find", { query: "x" }, null);
    await sessionTracer.endStep(profile, true, undefined, null);
    const traces = sessionTracer.getTraces(profile);
    expect((traces[traces.length - 1] as any).locationFailure).toBeUndefined();
    sessionTracer.clear(profile);
  });
});
