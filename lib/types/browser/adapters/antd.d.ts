import type { Locator, Page } from "playwright-core";
import type { ActionContext, ActionResult, FormFieldItem, QuiescenceOptions, SelectContext, SelectResult, UIAdapter, VirtualExtractOptions } from "./types.js";
export declare class AntDesignAdapter implements UIAdapter {
    readonly name = "ant-design";
    /** 活动弹窗/抽屉选择器 */
    readonly activeDialogSelector = ".ant-modal:not([style*='display: none']), .ant-drawer:not([style*='display: none'])";
    /** 探测当前页面是否使用了 Ant Design 体系 */
    matches(page: Page): Promise<boolean>;
    /** 语义抽取钩子 (注意：函数将在页内自包含执行，不得引用外部闭包) */
    readonly extractionHook: {
        resolveName(el: Element, role: string): string | null;
        resolveRole(el: Element): string | null;
        checkVisible(el: Element): boolean | null;
    };
    /** 交互动作拦截器 (主机侧执行) */
    readonly actionInterceptor: {
        beforeAction(ctx: ActionContext): Promise<Locator | void>;
        onActionError(ctx: ActionContext, error: Error): Promise<ActionResult | void>;
    };
    /** 页面稳态等待 */
    waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean>;
    /** 判断是否匹配 Ant Design 下拉触发器 */
    matchesSelect(ctx: SelectContext): Promise<boolean>;
    /** 执行 Ant Design 下拉选择 */
    selectOption(ctx: SelectContext): Promise<SelectResult>;
    /** Ant Design 表单项精准识别与填充 */
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
//# sourceMappingURL=antd.d.ts.map