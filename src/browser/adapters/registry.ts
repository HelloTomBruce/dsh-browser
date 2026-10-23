// dsh-browser · 适配器注册与分发管理器 (UI Adapter Registry)
import type { Page } from "playwright-core";
import { AntDesignAdapter } from "./antd.js";
import { ElementPlusAdapter } from "./element.js";
import { GenericAdapter } from "./generic.js";
import type {
  ActionContext,
  ActionResult,
  FormFieldItem,
  SelectContext,
  SelectResult,
  UIAdapter,
  VirtualExtractOptions,
} from "./types.js";

class UIAdapterRegistryImpl {
  private adapters: Map<string, UIAdapter> = new Map();
  private pageAdapterCache: WeakMap<Page, UIAdapter> = new WeakMap();

  constructor() {
    // 默认内置注册通用适配器与主流 UI 适配器
    this.register(new GenericAdapter());
    this.register(new AntDesignAdapter());
    this.register(new ElementPlusAdapter());
  }

  /** 注册新的 UI 适配器插件 */
  register(adapter: UIAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /** 获取指定适配器 */
  get(name: string): UIAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * 自动探测并获取当前页面对应的适配器
   * 结果绑定到 Page 弱引用缓存中，避免重复探测
   */
  async getActiveAdapter(page: Page): Promise<UIAdapter> {
    const cached = this.pageAdapterCache.get(page);
    if (cached) return cached;

    // 优先匹配特异性适配器 (排除 generic 兜底)
    for (const [name, adapter] of this.adapters.entries()) {
      if (name === "generic") continue;
      try {
        if (await adapter.matches(page)) {
          this.pageAdapterCache.set(page, adapter);
          return adapter;
        }
      } catch {
        // 探测失败继续尝试下一个
      }
    }

    const fallback = this.adapters.get("generic")!;
    this.pageAdapterCache.set(page, fallback);
    return fallback;
  }

  /**
   * 聚合所有已注册适配器的活动弹窗/对话框选择器
   */
  getActiveDialogSelectors(): string {
    const selectors: string[] = [];
    for (const adapter of this.adapters.values()) {
      if (adapter.activeDialogSelector) {
        selectors.push(adapter.activeDialogSelector);
      }
    }
    return selectors.join(", ");
  }

  /**
   * 调度器入口: 自动根据目标节点特征解析最合适的 UI 适配器执行下拉交互
   */
  async executeSelect(ctx: SelectContext): Promise<SelectResult> {
    // 1. 优先尝试当前激活适配器
    const active = await this.getActiveAdapter(ctx.page);
    if (active.name !== "generic" && active.matchesSelect && (await active.matchesSelect(ctx))) {
      if (active.selectOption) return await active.selectOption(ctx);
    }

    // 2. 遍历其余特异性适配器匹配
    for (const [name, adapter] of this.adapters.entries()) {
      if (name === "generic" || name === active.name) continue;
      if (adapter.matchesSelect && (await adapter.matchesSelect(ctx))) {
        if (adapter.selectOption) return await adapter.selectOption(ctx);
      }
    }

    // 3. 通用适配器兜底 (含原生 select 与通用 ARIA)
    const generic = this.adapters.get("generic");
    if (generic?.selectOption) {
      return await generic.selectOption(ctx);
    }

    throw new Error(`未找到匹配的下拉适配器: ${ctx.label}`);
  }

  /**
   * 清理页面的适配器缓存 (通常在页面发生整页导航时调用)
   */
  clearCache(page: Page): void {
    this.pageAdapterCache.delete(page);
  }

  /**
   * 动作预处理管道 (执行目标提升等)
   */
  async beforeAction(ctx: ActionContext) {
    const adapter = await this.getActiveAdapter(ctx.page);
    if (adapter.actionInterceptor?.beforeAction) {
      return adapter.actionInterceptor.beforeAction(ctx);
    }
  }

  /**
   * 动作异常自愈管道 (处理遮罩层、阻挡重试等)
   */
  async onActionError(ctx: ActionContext, error: Error): Promise<ActionResult | void> {
    const adapter = await this.getActiveAdapter(ctx.page);
    if (adapter.actionInterceptor?.onActionError) {
      return adapter.actionInterceptor.onActionError(ctx, error);
    }
  }

  /**
   * 表单项智能填充调度：
   * 优先尝试当前匹配的 UI 框架特异性适配器，若未处理则交由通用适配器兜底
   */
  async fillFormField(
    page: Page,
    field: FormFieldItem,
    scope?: string,
  ): Promise<{ handled: boolean; error?: string }> {
    const active = await this.getActiveAdapter(page);
    if (active.fillFormField) {
      const res = await active.fillFormField(page, field, scope);
      if (res.handled) return res;
    }

    const generic = this.adapters.get("generic");
    if (generic?.fillFormField) {
      return await generic.fillFormField(page, field, scope);
    }

    return { handled: false, error: "未找到能处理该字段的适配器" };
  }

  async fillDate(ctx: ActionContext, field: string, dateValue: string | [string, string]): Promise<boolean> {
    const active = await this.getActiveAdapter(ctx.page);
    if (active.fillDate && (await active.fillDate(ctx, field, dateValue))) return true;
    const generic = this.adapters.get("generic");
    return generic?.fillDate ? generic.fillDate(ctx, field, dateValue) : false;
  }

  async selectPath(ctx: ActionContext, field: string, path: string[]): Promise<boolean> {
    const active = await this.getActiveAdapter(ctx.page);
    if (active.selectPath && (await active.selectPath(ctx, field, path))) return true;
    const generic = this.adapters.get("generic");
    return generic?.selectPath ? generic.selectPath(ctx, field, path) : false;
  }

  async transferItems(
    ctx: ActionContext,
    selector: string,
    direction: "left" | "right",
    items: string[],
  ): Promise<boolean> {
    const active = await this.getActiveAdapter(ctx.page);
    if (active.transferItems && (await active.transferItems(ctx, selector, direction, items))) return true;
    const generic = this.adapters.get("generic");
    return generic?.transferItems ? generic.transferItems(ctx, selector, direction, items) : false;
  }

  async extractVirtualList(page: Page, options: VirtualExtractOptions): Promise<Record<string, any>[]> {
    const active = await this.getActiveAdapter(page);
    if (active.extractVirtualList) {
      const res = await active.extractVirtualList(page, options);
      if (res && res.length > 0) return res;
    }
    const generic = this.adapters.get("generic");
    return generic?.extractVirtualList ? generic.extractVirtualList(page, options) : [];
  }

  async fillEditorContent(ctx: ActionContext, selector: string, content: string): Promise<boolean> {
    const active = await this.getActiveAdapter(ctx.page);
    if (active.fillEditorContent && (await active.fillEditorContent(ctx, selector, content))) return true;
    const generic = this.adapters.get("generic");
    return generic?.fillEditorContent ? generic.fillEditorContent(ctx, selector, content) : false;
  }

  async dragAndDrop(ctx: ActionContext, sourceSelector: string, targetSelector: string): Promise<boolean> {
    const active = await this.getActiveAdapter(ctx.page);
    if (active.dragAndDrop && (await active.dragAndDrop(ctx, sourceSelector, targetSelector))) return true;
    const generic = this.adapters.get("generic");
    return generic?.dragAndDrop ? generic.dragAndDrop(ctx, sourceSelector, targetSelector) : false;
  }
}

export const adapterRegistry = new UIAdapterRegistryImpl();
