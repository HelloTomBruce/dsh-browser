import type { Locator, Page } from "playwright-core";
export interface Point {
    x: number;
    y: number;
}
export interface MouseOptions {
    speed?: "slow" | "normal" | "fast";
    steps?: number;
}
/**
 * 获取当前页面记录的鼠标坐标，若未记录则默认返回初始点 (100, 100)
 */
export declare function getMousePosition(page: Page): Point;
export declare function setMousePosition(page: Page, pos: Point): void;
/**
 * 生成起点到终点的三次贝塞尔平滑轨迹点序列
 * B(t) = (1-t)^3 * P0 + 3(1-t)^2 * t * P1 + 3(1-t) * t^2 * P2 + t^3 * P3
 */
export declare function generateBezierPath(start: Point, end: Point, stepCount?: number): Point[];
/**
 * 拟人化平滑移动鼠标至指定像素坐标
 */
export declare function humanMove(page: Page, target: Point, options?: MouseOptions): Promise<void>;
/**
 * 拟人化微偏随机点击元素
 */
export declare function humanClick(page: Page, locator: Locator, options?: MouseOptions): Promise<boolean>;
//# sourceMappingURL=mouse.d.ts.map