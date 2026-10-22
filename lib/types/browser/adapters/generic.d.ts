import type { Page } from "playwright-core";
import type { QuiescenceOptions, SelectContext, SelectResult, UIAdapter } from "./types.js";
export declare class GenericAdapter implements UIAdapter {
    readonly name = "generic";
    /** 通用 W3C 标准弹窗选择器 */
    readonly activeDialogSelector = "[role='dialog']:not([style*='display: none']), dialog[open]";
    matches(_page: Page): Promise<boolean>;
    readonly extractionHook: {
        resolveName(el: Element, _role: string): string | null;
        checkVisible(el: Element): boolean | null;
    };
    /** 兜底匹配所有下拉交互 */
    matchesSelect(_ctx: SelectContext): Promise<boolean>;
    /** 执行下拉选择：支持原生 <select> 与通用 ARIA combobox/listbox */
    selectOption(ctx: SelectContext): Promise<SelectResult>;
    waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean>;
}
//# sourceMappingURL=generic.d.ts.map