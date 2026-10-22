import type { Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
export declare function waitTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    waitedMs: number;
}>;
/**
 * 条件检查引擎(测试原语共用)。
 *
 * cond 支持四类(每类内部互斥,取第一个存在的字段):
 *   { selector: "#btn", state: "visible|hidden|attached|detached" }  元素状态(默认 visible)
 *   { url: "正则字符串" }                                            当前 URL 匹配
 *   { text: "子串" }                                                  body 可见文本包含
 *   { count: { selector, op: "eq|gt|gte|lt|lte", value: n } }         元素数量比较
 *   { eval: "JS 表达式" }                                            表达式求值 truthy
 */
export type TestCondition = Record<string, any>;
/** 单次检查:返回 { ok, detail }。不抛错,失败时 detail 给出原因。 */
export declare function checkOnce(page: Page, cond: TestCondition): Promise<{
    ok: boolean;
    detail?: string;
}>;
/** 轮询等待条件成立(intervalMs 步进),返回最后一次检查结果。 */
export declare function pollCondition(page: Page, cond: TestCondition, timeoutMs: number, intervalMs?: number): Promise<{
    ok: boolean;
    detail?: string;
}>;
/** 通用显式等待:等待条件成立,超时抛错。 */
export declare function waitForTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    met: boolean;
}>;
/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。visual 断言走像素比对。 */
export declare function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    passed: boolean;
    visual: {
        baseline: string;
        diffRatio: number;
        diffPixels: number;
    };
} | {
    url: string;
    title: string;
    passed: boolean;
}>;
/** 网络记录查询:list / failed / wait / clear。兼容 (args) 与 (config, args) 两种调用签名。 */
export declare function networkTool(configOrArgs?: Record<string, any>, maybeArgs?: Record<string, any>): Promise<{
    cleared: boolean;
    entries: never[];
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
} | {
    matched: import("../session.js").NetworkEntry;
    waitMs: number;
    cleared?: undefined;
    entries?: undefined;
    stats?: undefined;
    failed?: undefined;
} | {
    stats: {
        host: string;
        total: number;
        failed: number;
        avgMs: number | null;
        byStatus: Record<string, number>;
    }[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    failed?: undefined;
} | {
    failed: import("../session.js").NetworkEntry[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
} | {
    entries: import("../session.js").NetworkEntry[];
    cleared?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
}>;
//# sourceMappingURL=testing.d.ts.map