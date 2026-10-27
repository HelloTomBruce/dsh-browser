// 页面漂移防护测试(未发版):expectUrl 前置校验、语义扫描指纹复核(navRace)、
// semantic miss 漂移上下文(navSinceStable)、外部导航 warning(note/drain)。
import { describe, it, expect, vi } from "vitest";
import type { Page } from "playwright-core";
import { assertExpectedUrl } from "../src/browser/tools/common.js";
import { resolveTargetLocator } from "../src/browser/session/target.js";
import {
  markStableNav,
  navSinceStable,
  noteExternalNav,
  drainExternalNavWarning,
  bumpPageNav,
} from "../src/browser/session/cache.js";

describe("assertExpectedUrl(expectUrl opt-in 前置校验)", () => {
  const page = { url: () => "https://app.example/#/object-scene/detail" } as unknown as Page;

  it("不传/空串:零校验直通", async () => {
    await expect(assertExpectedUrl(page, undefined, "click")).resolves.toBeUndefined();
    await expect(assertExpectedUrl(page, "", "type")).resolves.toBeUndefined();
  });

  it("正则命中:通过", async () => {
    await expect(assertExpectedUrl(page, "#/object-scene/", "click")).resolves.toBeUndefined();
    await expect(assertExpectedUrl(page, "object-scene/.*detail$", "select")).resolves.toBeUndefined();
  });

  it("不符:抛一句话可诊断错误(附当前 URL)", async () => {
    await expect(assertExpectedUrl(page, "#/base-station/", "click")).rejects.toThrow(
      /click 前置校验失败.*当前: https:\/\/app\.example\/#\/object-scene\/detail/s,
    );
  });

  it("非法正则:吞掉 RegExp 语法错误回退子串(报我方前置校验错误而非 SyntaxError)", async () => {
    await expect(assertExpectedUrl(page, "#/object-scene/[", "click")).rejects.toThrow(/前置校验失败/);
    await expect(assertExpectedUrl(page, "#/base-station/[", "click")).rejects.toThrow(/前置校验失败/);
  });
});

describe("what 语义解析漂移防护", () => {
  function fakePageWithScan(evaluateImpl: () => Promise<unknown>, url = "https://app.example/#/page-a") {
    const locStub: any = { first: () => locStub, count: vi.fn().mockResolvedValue(0) };
    const mockPage: any = {
      url: vi.fn().mockReturnValue(url),
      evaluate: vi.fn().mockImplementation(evaluateImpl),
      locator: vi.fn().mockReturnValue(locStub),
      getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), first: vi.fn().mockReturnThis() }),
    };
    return { mockPage: mockPage as unknown as Page, locStub };
  }

  it("扫描期间发生导航(navSeq 变化):结果作废抛 navRace 错误", async () => {
    const { mockPage } = fakePageWithScan(async () => {
      bumpPageNav(mockPage); // 模拟扫描窗口内主 frame 导航
      return { matches: [{ role: "button", name: "厂家", selector: "#hit", visible: true, score: 1 }], candidates: [], scanned: 3 };
    });
    const err = await resolveTargetLocator(mockPage, { what: "厂家" }).catch((e) => e);
    expect(err.message).toMatch(/页面在语义定位过程中发生变化/);
    expect(err.locationFailure).toMatchObject({ phase: "navRace" });
  });

  it("扫描期间 URL 变化(navSeq 未变,如同文档 hash 改写):同样作废", async () => {
    let url = "https://app.example/#/page-a";
    const locStub: any = { first: () => locStub, count: vi.fn().mockResolvedValue(1) };
    const mockPage: any = {
      url: vi.fn(() => url),
      evaluate: vi.fn().mockImplementation(async () => {
        url = "https://app.example/#/page-b";
        return { matches: [{ role: "button", name: "厂家", selector: "#hit", visible: true, score: 1 }], candidates: [], scanned: 3 };
      }),
      locator: vi.fn().mockReturnValue(locStub),
      getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0), first: vi.fn().mockReturnThis() }),
    };
    await expect(resolveTargetLocator(mockPage as unknown as Page, { what: "厂家" })).rejects.toThrow(
      /页面在语义定位过程中发生变化.*page-a → .*page-b/s,
    );
  });

  it("扫描稳定:正常返回,不误伤", async () => {
    const { mockPage } = fakePageWithScan(async () => ({
      matches: [{ role: "button", name: "厂家", selector: "#hit", visible: true, score: 1 }],
      candidates: [],
      scanned: 3,
    }));
    const res = await resolveTargetLocator(mockPage, { what: "厂家" });
    expect(res.matchedCount).toBe(1);
  });

  it("semantic miss 且距上次成功操作有导航:错误附漂移上下文", async () => {
    const { mockPage } = fakePageWithScan(
      async () => ({ matches: [], candidates: [], scanned: 3 }),
      "https://app.example/#/object-scene",
    );
    markStableNav(mockPage);
    bumpPageNav(mockPage); // 上次成功操作后页面发生过一次导航
    const err = await resolveTargetLocator(mockPage, { what: "厂家" }).catch((e) => e);
    expect(err.message).toMatch(/语义定位未命中/);
    expect(err.message).toMatch(/已发生 1 次导航.*当前: https:\/\/app\.example\/#\/object-scene/s);
  });
});

describe("外部导航记录(cache helpers)", () => {
  it("navSinceStable:默认 0,markStable 后随导航递增", () => {
    const page = {} as Page;
    expect(navSinceStable(page)).toBe(0); // 未打点视为无漂移
    markStableNav(page);
    expect(navSinceStable(page)).toBe(0);
    bumpPageNav(page);
    bumpPageNav(page);
    expect(navSinceStable(page)).toBe(2);
  });

  it("noteExternalNav → drainExternalNavWarning:拼装文案并一次性清空", () => {
    const page = {} as Page;
    expect(drainExternalNavWarning(page)).toBeUndefined();
    noteExternalNav(page, "https://app.example/#/page-b");
    noteExternalNav(page, "https://app.example/#/page-c");
    const warning = drainExternalNavWarning(page);
    expect(warning).toContain("非工具触发的页面导航");
    expect(warning).toContain("#/page-b → https://app.example/#/page-c");
    expect(drainExternalNavWarning(page)).toBeUndefined(); // 已 drain
  });
});
