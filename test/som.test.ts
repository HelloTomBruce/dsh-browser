// test/som.test.ts
// 多模态 SoM (Set-of-Marks) 视口标徽截图测试
import { describe, expect, it, vi } from "vitest";
import { screenshotTool } from "../src/browser/tools/inspection.js";
import type { BrowserConfig } from "../src/browser/types.js";

vi.mock("../src/browser/session.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

import { getPage } from "../src/browser/session.js";

describe("多模态 SoM 视口标徽 (Set-of-Marks)", () => {
  const config: BrowserConfig = { timeoutMs: 2000, screenshotDir: ".dsh-browser/test-screenshots" };

  it("som: true 时应提取交互标徽并在截图后自清", async () => {
    const evaluateCalls: any[] = [];
    const mockPage: any = {
      evaluate: vi.fn().mockImplementation((fn, arg) => {
        evaluateCalls.push({ fn, arg });
        // 如果是 injectSomOverlay，返回模拟标徽
        if (typeof fn === "function" && arg?.maxMarks) {
          return [
            { id: 1, role: "button", name: "登录" },
            { id: 2, role: "textbox", name: "用户名" },
          ];
        }
        return undefined;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("mock-png-buffer")),
      viewportSize: () => ({ width: 1280, height: 800 }),
    };

    (getPage as any).mockResolvedValue(mockPage);

    const res: any = await screenshotTool(config, {
      name: "test-som-shot",
      som: true,
      somColor: "blue",
    });

    expect(res.som).toBe(true);
    expect(res.somMarks).toHaveLength(2);
    expect(res.somMarks?.[0]).toEqual({ id: 1, role: "button", name: "登录" });
    expect(mockPage.screenshot).toHaveBeenCalled();
    // 验证 evaluate 被调用了两次: 第一次注入, 第二次自清
    expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
  });
});
