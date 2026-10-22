import type { Locator, Page } from "playwright-core";
export interface SelectContext {
    page: Page;
    target: Locator;
    label: string;
    want: string;
    exact: boolean;
    timeout: number;
}
export interface SelectResult {
    selected: string;
}
export interface SelectAdapter {
    readonly name: string;
    matches(ctx: SelectContext): Promise<boolean>;
    select(ctx: SelectContext): Promise<SelectResult>;
}
/**
 * 调度器入口:自动根据目标节点特征解析最合适的 UI 适配器执行交互。
 */
export declare function executeSelectAdapter(ctx: SelectContext): Promise<SelectResult>;
//# sourceMappingURL=select.d.ts.map