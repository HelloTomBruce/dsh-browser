// test/viewport-snapshot.test.ts
// 视口感知快照与跨 Frame 树合成测试
import { describe, expect, it, vi } from "vitest";
import { snapshotTool } from "../src/browser/tools/inspection.js";
import type { BrowserConfig } from "../src/browser/types.js";
import { setPageRefs } from "../src/browser/session/cache.js";

// Mock getPage
vi.mock("../src/browser/session.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

import { getPage } from "../src/browser/session.js";

describe("视口感知快照与多 Frame 树合成", () => {
  const config: BrowserConfig = { timeoutMs: 1000 };

  it("viewportOnly 开启时应携带视口修剪统计", async () => {
    const mockMainFrame: any = {
      evaluate: vi.fn().mockResolvedValue({
        tree: "- button \"搜索\" [ref=e1]",
        refs: [{ ref: "e1", role: "button", name: "搜索", selector: "#search" }],
        truncated: false,
        scopeMissing: false,
        prunedCount: 15,
      }),
    };

    const mockPage: any = {
      url: () => "https://example.com/app",
      title: async () => "App Page",
      mainFrame: () => mockMainFrame,
      frames: () => [mockMainFrame],
    };

    (getPage as any).mockResolvedValue(mockPage);

    const res: any = await snapshotTool(config, {
      mode: "aria",
      viewportOnly: true,
      viewportPadding: 20,
    });

    expect(res.tree).toContain("[ref=e1]");
    expect(res.viewportOnly).toBe(true);
    expect(res.prunedCount).toBe(15);
  });

  it("跨 Frame 页面应自动合成带有 f{index}: 命名空间 ref 的树", async () => {
    const mockMainFrame: any = {
      evaluate: vi.fn().mockResolvedValue({
        tree: "- button \"主按钮\" [ref=e1]",
        refs: [{ ref: "e1", role: "button", name: "主按钮", selector: "#btn1" }],
        truncated: false,
        scopeMissing: false,
        prunedCount: 0,
      }),
    };

    const mockSubFrame: any = {
      isDetached: () => false,
      name: () => "payment-iframe",
      url: () => "https://pay.example.com/checkout",
      evaluate: vi.fn().mockResolvedValue({
        tree: "- button \"确认付款\" [ref=e1]\n- textbox \"卡号\" [ref=e2]",
        refs: [
          { ref: "e1", role: "button", name: "确认付款", selector: "#pay-btn" },
          { ref: "e2", role: "textbox", name: "卡号", selector: "#card-no" },
        ],
        truncated: false,
        scopeMissing: false,
        prunedCount: 0,
      }),
    };

    const mockPage: any = {
      url: () => "https://example.com/shop",
      title: async () => "Shop Checkout",
      mainFrame: () => mockMainFrame,
      frames: () => [mockMainFrame, mockSubFrame],
    };

    (getPage as any).mockResolvedValue(mockPage);

    const res: any = await snapshotTool(config, {
      mode: "aria",
    });

    expect(res.tree).toContain("- button \"主按钮\" [ref=e1]");
    expect(res.tree).toContain("--- [frame: payment-iframe] ---");
    expect(res.tree).toContain("- button \"确认付款\" [ref=f1:e1]");
    expect(res.tree).toContain("- textbox \"卡号\" [ref=f1:e2]");
    expect(res.refs).toBe(3); // 1 + 2
  });
});
