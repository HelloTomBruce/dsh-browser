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

  it("镜像重复 iframe 自动去重折叠，避免 token 膨胀", async () => {
    const mockMainFrame: any = {
      evaluate: vi.fn().mockResolvedValue({
        tree: "- button \"主按钮\" [ref=e1]",
        refs: [{ ref: "e1", role: "button", name: "主按钮", selector: "#btn1" }],
        truncated: false,
        scopeMissing: false,
        prunedCount: 0,
      }),
    };

    const duplicateTree = "- button \"子业务项\" [ref=e1]\n- textbox \"参数\" [ref=e2]";
    const duplicateRefs = [
      { ref: "e1", role: "button", name: "子业务项", selector: "#sub-btn" },
      { ref: "e2", role: "textbox", name: "参数", selector: "#sub-param" },
    ];

    const makeSubFrame = (name: string) => ({
      isDetached: () => false,
      name: () => name,
      url: () => `https://example.com/${name}`,
      evaluate: vi.fn().mockResolvedValue({
        tree: duplicateTree,
        refs: duplicateRefs,
        truncated: false,
        scopeMissing: false,
        prunedCount: 0,
      }),
    });

    const f1 = makeSubFrame("system_config");
    const f2 = makeSubFrame("air_conditioner");
    const f3 = makeSubFrame("pv_storage");

    const mockPage: any = {
      url: () => "https://example.com/app",
      title: async () => "App",
      mainFrame: () => mockMainFrame,
      frames: () => [mockMainFrame, f1, f2, f3],
    };

    (getPage as any).mockResolvedValue(mockPage);

    const res: any = await snapshotTool(config, {
      mode: "aria",
    });

    // 第一次出现输出完整树
    expect(res.tree).toContain("--- [frame: system_config] ---");
    expect(res.tree).toContain("- button \"子业务项\" [ref=f1:e1]");

    // 第二次、第三次重复镜像被折叠
    expect(res.tree).toContain("--- [frame: air_conditioner] (同 system_config 镜像内容,已去重折叠) ---");
    expect(res.tree).toContain("--- [frame: pv_storage] (同 system_config 镜像内容,已去重折叠) ---");
  });

  it("scope 针对 modal/dialog 未命中时提供有针对性的已关闭诊断", async () => {
    const mockMainFrame: any = {
      evaluate: vi.fn().mockResolvedValue({
        tree: "",
        refs: [],
        truncated: false,
        scopeMissing: true,
        prunedCount: 0,
      }),
    };

    const mockPage: any = {
      url: () => "https://example.com/app",
      title: async () => "App",
      mainFrame: () => mockMainFrame,
      frames: () => [mockMainFrame],
    };

    (getPage as any).mockResolvedValue(mockPage);

    await expect(
      snapshotTool(config, {
        mode: "aria",
        scope: ".ant-modal",
      }),
    ).rejects.toThrow(/目标容器可能已消失（弹窗\/抽屉已关闭、已提交或页面已导航）/);
  });
});
