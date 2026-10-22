import type { SelectContext, SelectResult } from "./types.js";
export type { SelectContext, SelectResult };
/**
 * 下拉适配器接口 (向后兼容类型导出)
 */
export interface SelectAdapter {
    readonly name: string;
    matches(ctx: SelectContext): Promise<boolean>;
    select(ctx: SelectContext): Promise<SelectResult>;
}
/**
 * 调度器入口: 自动委托给 adapterRegistry 解析最合适的 UI 适配器执行交互。
 */
export declare function executeSelectAdapter(ctx: SelectContext): Promise<SelectResult>;
//# sourceMappingURL=select.d.ts.map