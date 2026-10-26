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

describe("定位参数互斥硬校验(ref/mark/what/selector 四选一)", () => {
  it("selector + what 同时传 → 报冲突并教学 what+scope 写法", async () => {
    const mockPage = {} as Page;
    await expect(
      resolveTargetLocator(mockPage, { selector: "[data-dsh-src='#modal']", what: "重 置" }),
    ).rejects.toThrow(/定位参数冲突.*what 与 selector.*what \+ scope/s);
  });

  it("两两冲突组合:selector+ref / ref+what / what+mark / selector+mark", async () => {
    const mockPage = {} as Page;
    await expect(resolveTargetLocator(mockPage, { selector: "#a", ref: "e1" })).rejects.toThrow(/定位参数冲突/);
    await expect(resolveTargetLocator(mockPage, { ref: "e1", what: "登录" })).rejects.toThrow(/定位参数冲突/);
    await expect(resolveTargetLocator(mockPage, { what: "登录", mark: 3 })).rejects.toThrow(/定位参数冲突/);
    await expect(resolveTargetLocator(mockPage, { selector: "#a", mark: 3 })).rejects.toThrow(/定位参数冲突/);
  });

  it("三个定位参数同时传 → 报冲突并列出全部", async () => {
    const mockPage = {} as Page;
    await expect(resolveTargetLocator(mockPage, { selector: "#a", ref: "e1", what: "登录" })).rejects.toThrow(
      /ref 与 what 与 selector/,
    );
  });

  it("row 管线豁免:row + selector 合法;row + what/ref 报冲突", async () => {
    const rowTarget = { id: "row-target" };
    const actionLoc: any = {
      filter: vi.fn().mockReturnThis(),
      first: vi.fn().mockReturnValue(rowTarget),
    };
    const filteredRow: any = {
      locator: vi.fn().mockReturnValue(actionLoc),
    };
    const rowLoc: any = {
      filter: vi.fn().mockReturnValue(filteredRow),
    };
    const mockPage = {
      locator: vi.fn().mockReturnValue(rowLoc),
    } as unknown as Page;
    const res = await resolveTargetLocator(mockPage, { row: "TASK-1002", action: "编辑", selector: "button.edit" });
    expect(res.locator).toBe(rowTarget);

    await expect(resolveTargetLocator(mockPage, { row: "TASK-1002", what: "编辑" })).rejects.toThrow(
      /row\/rowText 与 what/,
    );
    await expect(resolveTargetLocator(mockPage, { rowText: "TASK-1002", ref: "e1" })).rejects.toThrow(
      /row\/rowText 与 ref/,
    );
  });

  it("what + scope 合法组合不受互斥影响", async () => {
    // scope 不是定位参数,与 what 组合是容器内语义定位的正统写法;走到语义扫描
    // 即可(mock page.evaluate 返回零命中,证明通过了互斥校验进入 what 分支)
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({ matches: [], candidates: [], scanned: 0 }),
      getByRole: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
        first: vi.fn().mockReturnThis(),
      }),
      locator: vi.fn().mockReturnThis(),
    } as unknown as Page;
    await expect(resolveTargetLocator(mockPage, { what: "重置", scope: "#modal" })).rejects.toThrow(
      /语义定位未命中/,
    );
  });

  it("单一参数与空串 what 不受影响", async () => {
    const mockLocator = { first: () => "solo" } as unknown as Locator;
    const mockPage = { locator: vi.fn().mockReturnValue(mockLocator) } as unknown as Page;
    const res = await resolveTargetLocator(mockPage, { selector: "#only", what: "" });
    expect(res.locator).toBe("solo");
  });
});
