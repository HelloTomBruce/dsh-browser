// test/target-resolver.test.ts
// 统一目标解析与跨 Frame 定位测试
import { describe, expect, it, vi } from "vitest";
import { resolveTargetLocator, targetLocator } from "../src/browser/session/target.js";
import { setPageRefs } from "../src/browser/session/cache.js";
import type { Page, Frame, Locator } from "playwright-core";

describe("统一目标解析器 (Target Resolution Pipeline)", () => {
  it("通过 selector 参数直接定位元素", async () => {
    const mockLocator = { first: () => "mock-locator" } as unknown as Locator;
    const mockPage = {
      locator: vi.fn().mockReturnValue(mockLocator),
    } as unknown as Page;

    const res = await resolveTargetLocator(mockPage, { selector: "#submit-btn" });
    expect(res.isIFrame).toBe(false);
    expect(res.container).toBe(mockPage);
    expect(res.locator).toBe("mock-locator");
    expect(mockPage.locator).toHaveBeenCalledWith("#submit-btn");
  });

  it("无 selector 与 ref 时应报错", async () => {
    const mockPage = {} as Page;
    await expect(resolveTargetLocator(mockPage, {})).rejects.toThrow("需要 selector 或 ref 之一");
  });

  it("未知 ref 时应抛出指引性错误", async () => {
    const mockPage = {} as Page;
    setPageRefs(mockPage, new Map());
    await expect(resolveTargetLocator(mockPage, { ref: "e99" })).rejects.toThrow("未知 ref: e99");
  });

  it("主 Frame 的 ref 能正常定位并完成校验", async () => {
    const mockPage = {} as Page;
    const locatorMock: any = {
      first: () => locatorMock,
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue(true),
    };
    (mockPage as any).locator = vi.fn().mockReturnValue(locatorMock);

    setPageRefs(
      mockPage,
      new Map([
        ["e1", { role: "button", name: "确认", selector: "#confirm-btn" }],
      ]),
    );

    const res = await resolveTargetLocator(mockPage, { ref: "e1" });
    expect(res.isIFrame).toBe(false);
    expect(res.container).toBe(mockPage);
    expect(res.locator).toBe(locatorMock);
    expect(mockPage.locator).toHaveBeenCalledWith("#confirm-btn");
  });

  it("标记在子 Frame 的 ref 应自动切换至对应 Frame 容器", async () => {
    const mockPage = {} as Page;
    const mockSubFrameLocator: any = {
      first: () => mockSubFrameLocator,
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue(true),
    };

    const mockSubFrame: any = {
      locator: vi.fn().mockReturnValue(mockSubFrameLocator),
    };

    (mockPage as any).frames = vi.fn().mockReturnValue([mockPage, mockSubFrame]);
    (mockPage as any).locator = vi.fn();

    setPageRefs(
      mockPage,
      new Map([
        [
          "f1:e2",
          {
            role: "textbox",
            name: "授权码",
            selector: "#auth-code",
            frameIndex: 1,
            frameUrl: "https://auth.example.com",
          },
        ],
      ]),
    );

    const res = await resolveTargetLocator(mockPage, { ref: "f1:e2" });
    expect(res.isIFrame).toBe(true);
    expect(res.container).toBe(mockSubFrame);
    expect(res.locator).toBe(mockSubFrameLocator);
    expect(mockSubFrame.locator).toHaveBeenCalledWith("#auth-code");
    expect(mockPage.locator).not.toHaveBeenCalled();
  });

  it("引用的子 Frame 已被销毁时应抛出错误", async () => {
    const mockPage = {} as Page;
    (mockPage as any).frames = vi.fn().mockReturnValue([mockPage]); // 只有 1 个主 frame

    setPageRefs(
      mockPage,
      new Map([
        [
          "f2:e1",
          {
            role: "button",
            name: "支付",
            selector: "#pay",
            frameIndex: 2,
          },
        ],
      ]),
    );

    await expect(resolveTargetLocator(mockPage, { ref: "f2:e1" })).rejects.toThrow(
      "引用元素所在的子 Frame (index=2) 已失效或销毁",
    );
  });

  it("targetLocator 快捷辅助方法应返回 locator", async () => {
    const mockLocator = { first: () => "simple-locator" } as unknown as Locator;
    const mockPage = {
      locator: vi.fn().mockReturnValue(mockLocator),
    } as unknown as Page;

    const loc = await targetLocator(mockPage, { selector: ".btn" });
    expect(loc).toBe("simple-locator");
  });

  it("当存在多个匹配节点时优先选取 visible=true 的可见元素", async () => {
    const mockVisibleFirst = { id: "visible-node" };
    const mockVisibleLocator: any = {
      count: vi.fn().mockResolvedValue(1),
      first: vi.fn().mockReturnValue(mockVisibleFirst),
    };

    const mockBaseFirst = { id: "hidden-first-node" };
    const mockBaseLocator: any = {
      count: vi.fn().mockResolvedValue(2),
      first: vi.fn().mockReturnValue(mockBaseFirst),
      locator: vi.fn().mockImplementation((subSelector: string) => {
        if (subSelector === "visible=true") return mockVisibleLocator;
        return mockBaseLocator;
      }),
    };

    const mockPage = {
      locator: vi.fn().mockReturnValue(mockBaseLocator),
    } as unknown as Page;

    const res = await resolveTargetLocator(mockPage, { selector: ".ant-dropdown-menu-item" });
    expect(res.locator).toBe(mockVisibleFirst);
    expect(res.matchedCount).toBe(2);
    expect(res.visibleCount).toBe(1);
  });
});
