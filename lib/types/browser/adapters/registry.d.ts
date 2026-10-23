import type { Page } from "playwright-core";
import type { ActionContext, ActionResult, FormFieldItem, SelectContext, SelectResult, UIAdapter, VirtualExtractOptions } from "./types.js";
declare class UIAdapterRegistryImpl {
    private adapters;
    private pageAdapterCache;
    constructor();
    /** 注册新的 UI 适配器插件 */
    register(adapter: UIAdapter): void;
    /** 获取指定适配器 */
    get(name: string): UIAdapter | undefined;
    /**
     * 自动探测并获取当前页面对应的适配器
     * 结果绑定到 Page 弱引用缓存中，避免重复探测
     */
    getActiveAdapter(page: Page): Promise<UIAdapter>;
    /**
     * 聚合所有已注册适配器的活动弹窗/对话框选择器
     */
    getActiveDialogSelectors(): string;
    /**
     * 调度器入口: 自动根据目标节点特征解析最合适的 UI 适配器执行下拉交互
     */
    executeSelect(ctx: SelectContext): Promise<SelectResult>;
    /**
     * 清理页面的适配器缓存 (通常在页面发生整页导航时调用)
     */
    clearCache(page: Page): void;
    /**
     * 动作预处理管道 (执行目标提升等)
     */
    beforeAction(ctx: ActionContext): Promise<void | import("playwright-core").Locator>;
    /**
     * 动作异常自愈管道 (处理遮罩层、阻挡重试等)
     */
    onActionError(ctx: ActionContext, error: Error): Promise<ActionResult | void>;
    /**
     * 表单项智能填充调度：
     * 优先尝试当前匹配的 UI 框架特异性适配器，若未处理则交由通用适配器兜底
     */
    fillFormField(page: Page, field: FormFieldItem, scope?: string): Promise<{
        handled: boolean;
        error?: string;
    }>;
    fillDate(ctx: ActionContext, field: string, dateValue: string | [string, string]): Promise<boolean>;
    selectPath(ctx: ActionContext, field: string, path: string[]): Promise<boolean>;
    transferItems(ctx: ActionContext, selector: string, direction: "left" | "right", items: string[]): Promise<boolean>;
    extractVirtualList(page: Page, options: VirtualExtractOptions): Promise<Record<string, any>[]>;
    fillEditorContent(ctx: ActionContext, selector: string, content: string): Promise<boolean>;
    dragAndDrop(ctx: ActionContext, sourceSelector: string, targetSelector: string): Promise<boolean>;
}
export declare const adapterRegistry: UIAdapterRegistryImpl;
export {};
//# sourceMappingURL=registry.d.ts.map