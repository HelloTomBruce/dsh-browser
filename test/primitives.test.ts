// test/primitives.test.ts
// 通用 Web 交互原语单元测试 (Universal UI Primitives)
import { describe, expect, it, vi } from "vitest";
import {
  extractElementLabel,
  isElementDisabled,
  getActiveDialog,
  getActiveDialogSelectors,
  liftTargetIfHiddenInput,
  executeUniversalSelect,
  waitForDOMQuiescence,
} from "../src/browser/primitives/index.js";

describe("通用 Web 交互原语 (UI Primitives)", () => {
  describe("DOM 状态判定与语义提取", () => {
    it("isElementDisabled 应识别 native disabled、aria-disabled 及各种 disabled 类名", () => {
      expect(isElementDisabled({ hasAttribute: (a: string) => a === "disabled" } as any)).toBe(true);
      expect(isElementDisabled({ hasAttribute: () => false, disabled: true } as any)).toBe(true);
      expect(
        isElementDisabled({
          hasAttribute: () => false,
          getAttribute: (a: string) => (a === "aria-disabled" ? "true" : null),
        } as any),
      ).toBe(true);
      expect(
        isElementDisabled({
          hasAttribute: () => false,
          getAttribute: () => null,
          matches: (sel: string) => sel.includes("is-disabled"),
        } as any),
      ).toBe(true);
      expect(
        isElementDisabled({
          hasAttribute: () => false,
          getAttribute: () => null,
          matches: () => false,
          closest: () => null,
        } as any),
      ).toBe(false);
    });

    it("extractElementLabel 应提取原生 label 与包装容器文本", () => {
      // 1. input.labels
      const mockInputWithLabels: any = {
        labels: [{ innerText: "用户名" }],
      };
      expect(extractElementLabel(mockInputWithLabels)).toBe("用户名");

      // 2. 表单容器 label
      const mockLabelEl = { innerText: "集群配置" };
      const mockContainer = {
        querySelector: vi.fn().mockReturnValue(mockLabelEl),
      };
      const mockInputInForm: any = {
        closest: vi.fn().mockReturnValue(mockContainer),
      };
      expect(extractElementLabel(mockInputInForm)).toBe("集群配置");
    });
  });

  describe("活动弹窗与隔离容器原语", () => {
    it("getActiveDialogSelectors 应包含标准 WAI-ARIA role='dialog' 与通用 modal 选择器", () => {
      const selectors = getActiveDialogSelectors();
      expect(selectors).toContain("role='dialog'");
      expect(selectors).toContain("aria-modal='true'");
      expect(selectors).toContain(".ant-modal");
      expect(selectors).toContain(".el-dialog");
    });

    it("getActiveDialog 应定位顶层弹窗容器", () => {
      const mockLocator: any = {
        last: vi.fn().mockReturnValue("top-dialog"),
        first: vi.fn().mockReturnValue("top-dialog"),
      };
      const mockPage: any = {
        locator: vi.fn().mockReturnValue(mockLocator),
      };
      const dialog = getActiveDialog(mockPage);
      expect(dialog).toBe("top-dialog");
      expect(mockPage.locator).toHaveBeenCalledWith(getActiveDialogSelectors());
    });
  });

  describe("隐藏目标提升原语 (Target Lifting)", () => {
    it("若目标为隐藏的 checkbox/radio，应自动提升至父级 label 或 wrapper", async () => {
      const mockParent = { count: vi.fn().mockResolvedValue(1), first: vi.fn().mockReturnValue("lifted-wrapper") };
      const mockTarget: any = {
        first: () => mockTarget,
        evaluate: vi.fn().mockResolvedValue(true), // 判定为隐藏 checkbox
        locator: vi.fn().mockReturnValue(mockParent),
      };

      const result = await liftTargetIfHiddenInput(mockTarget);
      expect(result).toBe("lifted-wrapper");
    });

    it("普通可见目标应保持原样", async () => {
      const mockTarget: any = {
        first: () => mockTarget,
        evaluate: vi.fn().mockResolvedValue(false),
      };

      const result = await liftTargetIfHiddenInput(mockTarget);
      expect(result).toBe(mockTarget);
    });
  });

  describe("通用下拉选择原语 (executeUniversalSelect)", () => {
    it("原生 select 标签应直接调用 selectOption", async () => {
      const mockTarget: any = {
        evaluate: vi.fn().mockResolvedValue("select"),
        selectOption: vi.fn().mockResolvedValue(undefined),
      };
      const mockPage: any = {};

      const res = await executeUniversalSelect({
        page: mockPage,
        target: mockTarget,
        want: "Option A",
      });

      expect(res.selected).toBe("Option A");
      expect(mockTarget.selectOption).toHaveBeenCalledWith({ label: "Option A" }, { timeout: 10000 });
    });
  });
});
