// test/adapters.test.ts
// 可插拔组件库适配器单元测试
import { describe, expect, it, vi } from "vitest";
import {
  AntDesignAdapter,
  ElementPlusAdapter,
  GenericAdapter,
  adapterRegistry,
  executeSelectAdapter,
  waitForDOMQuiescence,
} from "../src/browser/adapters/index.js";
import type { ActionContext, UIAdapter } from "../src/browser/adapters/types.js";

describe("可插拔 UI 适配器架构 (UI Adapters)", () => {
  it("adapterRegistry 默认应注册 generic, ant-design 与 element-plus", () => {
    expect(adapterRegistry.get("generic")).toBeDefined();
    expect(adapterRegistry.get("ant-design")).toBeDefined();
    expect(adapterRegistry.get("element-plus")).toBeDefined();
    expect(adapterRegistry.get("generic")).toBeInstanceOf(GenericAdapter);
    expect(adapterRegistry.get("ant-design")).toBeInstanceOf(AntDesignAdapter);
    expect(adapterRegistry.get("element-plus")).toBeInstanceOf(ElementPlusAdapter);
  });

  it("getActiveDialogSelectors 应聚合各适配器的选择器", () => {
    const selectors = adapterRegistry.getActiveDialogSelectors();
    expect(selectors).toContain("ant-modal");
    expect(selectors).toContain("el-dialog");
    expect(selectors).toContain("role='dialog'");
  });

  it("支持可插拔动态扩展新的适配器", () => {
    const mockCustomAdapter: UIAdapter = {
      name: "element-plus-custom",
      matches: async () => false,
    };
    adapterRegistry.register(mockCustomAdapter);
    expect(adapterRegistry.get("element-plus-custom")).toBe(mockCustomAdapter);
  });

  describe("AntDesignAdapter 语义提取与可见性", () => {
    const adapter = new AntDesignAdapter();

    it("matches 应正确识别 ant- 特征", async () => {
      const mockPageMatched: any = {
        evaluate: vi.fn().mockResolvedValue(true),
      };
      expect(await adapter.matches(mockPageMatched)).toBe(true);

      const mockPageUnmatched: any = {
        evaluate: vi.fn().mockResolvedValue(false),
      };
      expect(await adapter.matches(mockPageUnmatched)).toBe(false);
    });

    it("resolveName 应能提取包裹型容器文本", () => {
      const mockEl: any = {
        closest: vi.fn((sel: string) => {
          if (sel.includes(".ant-radio-wrapper")) {
            return { textContent: "  选项 A (推荐)  " };
          }
          return null;
        }),
      };
      const name = adapter.extractionHook.resolveName(mockEl, "radio");
      expect(name).toBe("选项 A (推荐)");
    });

    it("resolveName 应能反向提取 .ant-form-item-label 文本", () => {
      const mockLabel = { textContent: "集群名称" };
      const mockFormItem = {
        querySelector: vi.fn().mockReturnValue(mockLabel),
        contains: vi.fn().mockReturnValue(false),
      };
      const mockInput: any = {
        closest: vi.fn((sel: string) => (sel.includes(".ant-form-item") ? mockFormItem : null)),
      };
      const name = adapter.extractionHook.resolveName(mockInput, "textbox");
      expect(name).toBe("集群名称");
    });

    it("resolveRole 应能根据 Ant Design class 增强角色", () => {
      expect(adapter.extractionHook.resolveRole({ className: "ant-tabs-tab-btn" } as any)).toBe("tab");
      expect(adapter.extractionHook.resolveRole({ className: "ant-btn ant-btn-primary" } as any)).toBe("button");
      expect(adapter.extractionHook.resolveRole({ className: "ant-table-row" } as any)).toBe("row");
      expect(adapter.extractionHook.resolveRole({ className: "other-class" } as any)).toBeNull();
    });

    it("checkVisible 应识别 AntD 隐藏类名", () => {
      expect(
        adapter.extractionHook.checkVisible({
          className: "ant-modal-wrap ant-modal-wrap-hidden",
        } as any),
      ).toBe(false);
      expect(
        adapter.extractionHook.checkVisible({
          className: "ant-select-dropdown ant-select-dropdown-hidden",
        } as any),
      ).toBe(false);
    });
  });

  describe("AntDesignAdapter 交互动作拦截与自愈", () => {
    const adapter = new AntDesignAdapter();

    it("beforeAction 对非点击操作不作拦截", async () => {
      const ctx: ActionContext = {
        page: {} as any,
        config: {} as any,
        target: {} as any,
        action: "type",
        args: {},
      };
      const res = await adapter.actionInterceptor.beforeAction(ctx);
      expect(res).toBeUndefined();
    });

    it("onActionError 遇 ant-modal 遮罩拦截应返回 force: true 自愈指令", async () => {
      const ctx: ActionContext = {
        page: { waitForTimeout: vi.fn().mockResolvedValue(undefined) } as any,
        config: {} as any,
        target: {} as any,
        action: "click",
        args: {},
      };
      const err = new Error("locator.click: Timeout 30000ms exceeded. <div class=\"ant-modal-wrap\">…</div> intercepts pointer events");
      const res = await adapter.actionInterceptor.onActionError(ctx, err);
      expect(res).toEqual({
        handled: true,
        retryWith: { force: true, timeoutMs: 3000 },
      });
      expect(ctx.page.waitForTimeout).toHaveBeenCalledWith(100);
    });

    it("onActionError 遇非遮罩类错误应不接管 (handled: false)", async () => {
      const ctx: ActionContext = {
        page: {} as any,
        config: {} as any,
        target: {} as any,
        action: "click",
        args: {},
      };
      const err = new Error("locator.click: Target closed");
      const res = await adapter.actionInterceptor.onActionError(ctx, err);
      expect(res).toEqual({ handled: false });
    });
  });
});
