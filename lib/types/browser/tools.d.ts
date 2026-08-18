import type { Page } from "playwright-core";
import type { ToolRunContext } from "../lib/types.js";
import type { BrowserConfig } from "./types.js";
export declare function openTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    status: string;
}>;
export declare function snapshotTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    text: string;
    truncated: boolean;
    links: {
        text: string;
        href: string;
    }[];
    inputs: number;
    url: string;
    title: string;
}>;
export declare function clickTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    clicked: string;
}>;
export declare function typeTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    typed: boolean;
    selector: string;
    submit: boolean;
}>;
export declare function pressTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    pressed: string;
}>;
export declare function evalTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    result: unknown;
}>;
export declare function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
}>;
export declare function waitTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    waitedMs: number;
}>;
export declare function backTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
export declare function reloadTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
export declare function statusTool(): Promise<{
    open: boolean;
    profile: string;
    channel: string;
    tabs: number;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        channel: string;
        persistent: boolean;
    }[];
} | {
    url: string;
    title: string;
    open: boolean;
    profile: string;
    channel: string;
    tabs: number;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        channel: string;
        persistent: boolean;
    }[];
}>;
export declare function tabsTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    action: any;
    tabs: {
        id: number;
        url: string;
        title: string;
    }[];
    activeId: number;
    tab?: undefined;
} | {
    action: any;
    tab: {
        id: number;
        url: string;
        title: string;
    };
    tabs: {
        id: number;
        url: string;
        title: string;
    }[];
    activeId: number;
}>;
export declare function resolveTabId(args: Record<string, any>): number;
export declare function downloadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    filename: string;
    url: string;
    bytes: number;
}>;
export declare function uploadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    uploaded: string;
    bytes: number;
}>;
export declare function cookiesTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    cookies: {
        name: string;
        value: string;
        domain: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Strict" | "Lax" | "None";
        expires: number;
    }[];
    set?: undefined;
    name?: undefined;
    url?: undefined;
    cleared?: undefined;
} | {
    set: boolean;
    name: string;
    url: any;
    cookies?: undefined;
    cleared?: undefined;
} | {
    cleared: boolean;
    cookies?: undefined;
    set?: undefined;
    name?: undefined;
    url?: undefined;
}>;
export declare function formTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    filled: ({
        selector: any;
        label?: undefined;
    } | {
        label: any;
        selector?: undefined;
    })[];
    submit: boolean;
}>;
export declare function formSaveTool(args: Record<string, any>): Promise<{
    saved: string;
    fields: number;
}>;
export declare function formsTool(args: Record<string, any>): Promise<{
    forms: {
        name: string;
        fields: number;
        preview: string;
    }[];
    deleted?: undefined;
    name?: undefined;
} | {
    deleted: boolean;
    name: string;
    forms?: undefined;
}>;
export declare function profileTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    current: string;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        persistent: boolean;
        userDataDir: string;
    }[];
}>;
export declare function elementsTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    count: number;
    elements: Record<string, unknown>[];
}>;
export declare function closeTool(): Promise<{
    closed: boolean;
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
/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
 * successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
 * 超时返回 loggedIn:false(不抛错)。
 */
export declare function waitForLoginTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    loggedIn: boolean;
}>;
/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。 */
export declare function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    passed: boolean;
}>;
/** 网络记录查询:list / failed / wait / clear。 */
export declare function networkTool(args: Record<string, any>): Promise<{
    cleared: boolean;
    entries: number;
    matched?: undefined;
    waitMs?: undefined;
    failed?: undefined;
} | {
    matched: import("./session.js").NetworkEntry;
    waitMs: number;
    cleared?: undefined;
    entries?: undefined;
    failed?: undefined;
} | {
    failed: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
} | {
    entries: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    failed?: undefined;
}>;
/** 录制管理:start / stop / save / list / delete。 */
export declare function recordTool(args: Record<string, any>): Promise<{
    recording: boolean;
    hint: string;
    steps?: undefined;
    saved?: undefined;
    file?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    recording: boolean;
    steps: number;
    hint?: undefined;
    saved?: undefined;
    file?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    saved: string;
    steps: number;
    file: string;
    hint: string;
    recording?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    recordings: {
        name: string;
        steps: number;
        savedAt: number;
        preview: string;
    }[];
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    saved?: undefined;
    file?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    deleted: boolean;
    name: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    saved?: undefined;
    file?: undefined;
    recordings?: undefined;
}>;
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。 */
export declare function runReplay(steps: {
    tool: string;
    args: any;
}[], impls: Record<string, (args: any) => Promise<unknown>>, failFast: boolean): Promise<{
    total: number;
    passed: number;
    failed: number;
    stoppedAt: number | null;
    results: any[];
}>;
/** 回放入口:name(已保存录制)或 steps(数组)二选一。 */
export declare function replayTool(args: Record<string, any>, impls: Record<string, (args: any) => Promise<unknown>>): Promise<{
    summary: string;
    total: number;
    passed: number;
    failed: number;
    stoppedAt: number | null;
    results: any[];
    source: string;
}>;
//# sourceMappingURL=tools.d.ts.map