import type { ReplayStep } from "../types.js";
export interface CompileOptions {
    title?: string;
    baseUrl?: string;
}
/**
 * 将录制序列转译为符合行业标准规范的原生 Playwright TypeScript 测试代码
 */
export declare function compileToPlaywrightSpec(steps: ReplayStep[], options?: CompileOptions): string;
//# sourceMappingURL=playwright.d.ts.map