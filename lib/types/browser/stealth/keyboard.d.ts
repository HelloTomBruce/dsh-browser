import type { Page } from "playwright-core";
export interface TypeOptions {
    speed?: "slow" | "normal" | "fast";
}
/**
 * 基于 Box-Muller 变换的高斯分布随机数生成器
 */
export declare function gaussianRandom(mean?: number, stdev?: number, min?: number, max?: number): number;
/**
 * 拟人化敲击键盘输入文本
 */
export declare function humanType(page: Page, text: string, options?: TypeOptions): Promise<void>;
//# sourceMappingURL=keyboard.d.ts.map