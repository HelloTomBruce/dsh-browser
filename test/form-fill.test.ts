// test/form-fill.test.ts
// 智能批量表单填充工具 (browser_form_fill) 测试
import { describe, expect, it, vi } from "vitest";
import { formFillTool } from "../src/browser/tools/interaction.js";
import * as primitives from "../src/browser/primitives/index.js";
import type { BrowserConfig } from "../src/browser/types.js";

// Mock getPage
vi.mock("../src/browser/session.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    getPage: vi.fn(),
  };
});

import { getPage } from "../src/browser/session.js";

describe("智能批量表单填充 (browser_form_fill)", () => {
  const config: BrowserConfig = { timeoutMs: 2000 };

  it("缺少 fields 参数时应报错", async () => {
    await expect(formFillTool(config, {} as any)).rejects.toThrow("缺少 fields 参数");
    await expect(formFillTool(config, { fields: {} })).rejects.toThrow("缺少 fields 参数");
  });

  it("使用适配器批量填写表单字段并返回汇总", async () => {
    const mockPage: any = {
      evaluate: vi.fn().mockResolvedValue(true),
    };
    (getPage as any).mockResolvedValue(mockPage);

    // Mock 填充助手 fillFormFieldHelper
    const fillSpy = vi.spyOn(primitives, "fillFormFieldHelper").mockImplementation(async (_page, field) => {
      if (field.key === "username") return { handled: true };
      if (field.key === "city") return { handled: true };
      if (field.key === "unknown_field") return { handled: false, error: "元素未匹配" };
      return { handled: false };
    });

    const res = await formFillTool(config, {
      fields: {
        username: "alice",
        city: "Beijing",
        unknown_field: "foo",
      },
    });

    expect(res.filled).toEqual(["username", "city"]);
    expect(res.skipped).toEqual(["unknown_field"]);
    expect(res.errors["unknown_field"]).toBe("元素未匹配");

    fillSpy.mockRestore();
  });

  it("支持 submitButton 自动触发提交点击", async () => {
    const mockBtnLocator: any = {
      first: () => mockBtnLocator,
      count: vi.fn().mockResolvedValue(1),
      click: vi.fn().mockResolvedValue(undefined),
    };

    const mockPage: any = {
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue(mockBtnLocator),
      getByRole: vi.fn().mockReturnValue(mockBtnLocator),
    };
    (getPage as any).mockResolvedValue(mockPage);

    const fillSpy = vi.spyOn(primitives, "fillFormFieldHelper").mockResolvedValue({ handled: true });

    const res = await formFillTool(config, {
      fields: { title: "Test Title" },
      submitButton: "#submit-btn",
    });

    expect(res.filled).toContain("title");
    expect(res.submitted).toBe(true);
    expect(mockBtnLocator.click).toHaveBeenCalled();

    fillSpy.mockRestore();
  });
});
