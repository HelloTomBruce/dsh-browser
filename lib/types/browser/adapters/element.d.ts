import type { Page } from "playwright-core";
import type { QuiescenceOptions, SelectContext, SelectResult, UIAdapter } from "./types.js";
export declare class ElementPlusAdapter implements UIAdapter {
    readonly name = "element-plus";
    /** 活动弹窗/抽屉选择器 */
    readonly activeDialogSelector = ".el-dialog:not([style*='display: none']), .el-drawer:not([style*='display: none'])";
    /** 探测当前页面是否使用了 Element Plus 体系 */
    matches(page: Page): Promise<boolean>;
    /** 语义抽取钩子 */
    readonly extractionHook: {
        resolveName(el: Element, role: string): string | null;
        resolveRole(el: Element): string | null;
        checkVisible(el: Element): boolean | null;
    };
    /** 判断是否匹配 Element Plus 下拉触发器 */
    matchesSelect(ctx: SelectContext): Promise<boolean>;
    /** 执行 Element Plus 下拉选择 */
    selectOption(ctx: SelectContext): Promise<SelectResult>;
    waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean>;
}
//# sourceMappingURL=element.d.ts.map