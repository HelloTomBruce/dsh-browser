import type { Locator, Page } from "playwright-core";
import type { TargetResolution } from "../types.js";
/**
 * 统一解析目标元素：
 * 自动识别 selector 或 ref；若 ref 标记位于子 Frame，自动绑定到对应子 Frame 上下文。
 * 具备路径防漂移校验与 getByRole 自愈降级能力。
 */
export declare function resolveTargetLocator(page: Page, args: Record<string, any>): Promise<TargetResolution>;
/** 兼容旧版签名的目标定位快捷方式 */
export declare function targetLocator(page: Page, args: Record<string, any>): Promise<Locator>;
//# sourceMappingURL=target.d.ts.map