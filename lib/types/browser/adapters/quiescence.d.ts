import type { Page } from "playwright-core";
import type { QuiescenceOptions } from "./types.js";
/**
 * 等待页面 DOM 达到稳定状态
 * @param page Playwright Page 实例
 * @param options 等待选项
 * @returns boolean 成功达到稳态返回 true，超时返回 false
 */
export declare function waitForDOMQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean>;
//# sourceMappingURL=quiescence.d.ts.map