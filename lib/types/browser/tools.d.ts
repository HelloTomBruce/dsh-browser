import type { Locator, Page } from "playwright-core";
import type { ToolRunContext } from "../lib/types.js";
import type { BrowserConfig, ReplayStep, SelectorHint } from "./types.js";
import { type RunRecord } from "./reports.js";
/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
export declare function pngSize(buf: Buffer): {
    width: number;
    height: number;
};
/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
export declare function scaleRects(rects: {
    x: number;
    y: number;
    width: number;
    height: number;
}[], scale: number): {
    x: number;
    y: number;
    width: number;
    height: number;
}[];
export declare function openTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    status: string;
}>;
/**
 * 快照文本压缩(导出供测试):
 *   - 去掉首尾空白行;
 *   - 连续空白行折叠为 1 行;
 *   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
 * 只折叠完全相同的相邻行,不重排、不删改非重复内容。
 */
export declare function compressText(text: string): string;
export declare function snapshotTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    tree: string;
    truncated: boolean;
    refs: number;
    text?: undefined;
    links?: undefined;
    inputs?: undefined;
} | {
    url: string;
    title: string;
    text: string;
    truncated: boolean;
    links: {
        text: string;
        href: string;
    }[];
    inputs: number;
    tree?: undefined;
    refs?: undefined;
}>;
/**
 * 解析点击/输入目标为 Locator:selector 直译;ref 走注册表——
 * 先试快照时的 CSS 路径并校验 role/name 仍一致(防 ref 漂移误点),
 * 不一致则降级 getByRole(role, {name}),均失败报「ref 已失效」。
 */
export declare function targetLocator(page: Page, args: Record<string, any>): Promise<Locator>;
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
/**
 * 下拉选择原语:原生 <select> 走 selectOption;组件库下拉(antd/element/listbox)
 * 走「点击触发框 → 等待可见选项 → 按文本点击」。找不到选项时抛出错误并附当前可见
 * 选项清单,agent 可直接据此修正,无需再手写 eval 探查。
 */
export declare function selectTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    selected: string;
    selector: string;
}>;
export declare function evalTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    result: unknown;
}>;
export declare function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline: string;
} | {
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline?: undefined;
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
    dropdownOptions: string[];
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
/** 网络记录查询:list / failed / wait / clear。 */
export declare function networkTool(args: Record<string, any>): Promise<{
    cleared: boolean;
    entries: never[];
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
} | {
    matched: import("./session.js").NetworkEntry;
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
    failed: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
} | {
    entries: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
}>;
/** 使用 args.selector 定位的工具集合(自愈与录制指纹的作用范围)。 */
export declare const SELECTOR_STEP_TOOLS: Set<string>;
/**
 * 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
 * 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
 */
export declare function captureSelectorHint(page: Page, selector: string): Promise<SelectorHint | null>;
/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
export declare function healCandidates(hint: SelectorHint): {
    via: string;
    selector: string;
}[];
/** 录制管理:start / stop / save / list / delete。 */
export declare function recordTool(args: Record<string, any>): Promise<{
    recording: boolean;
    hint: string;
    steps?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    recording: boolean;
    steps: number;
    hint?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    hint: string;
    warnings?: string[] | undefined;
    varsApplied?: number | undefined;
    stripped?: number | undefined;
    saved: string;
    steps: number;
    source: string;
    file: string;
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
    deleted?: undefined;
    name?: undefined;
} | {
    deleted: boolean;
    name: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    recordings?: undefined;
}>;
/** 回放选项(自愈开关与单次尝试超时,来自 config)。 */
export interface ReplayOptions {
    healing?: boolean;
    healTimeoutMs?: number;
}
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
export declare function runReplay(steps: ReplayStep[], impls: Record<string, (args: any) => Promise<unknown>>, failFast: boolean, opts?: ReplayOptions): Promise<{
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
}>;
export interface ExtractField {
    name: string;
    selector: string;
    attr?: string;
    multiple?: boolean;
    fields?: ExtractField[];
}
/**
 * 把单页抽取结果规整为行数组:恰好一个顶层 multiple 字段时,其数组即行
 * (行内嵌套对象为行,标量包装成 { [name]: value });否则整页算一行。
 */
export declare function rowsOfExtract(result: Record<string, any>, fields: ExtractField[]): Record<string, any>[];
/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export declare function workspaceFilePath(cwd: string, file: string): string;
/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
export declare function extractTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    file?: string | undefined;
    bytes?: number | undefined;
    truncated: boolean;
    rows: Record<string, any>[];
    count: number;
    pages: number;
    format: string;
}>;
/**
 * 回归报告:list 列出最近运行,show 看单条详情,
 * export 聚合生成 Markdown/HTML 报告落盘工作区。
 */
export declare function reportTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    runs: {
        row?: number | undefined;
        runId: string;
        ts: number;
        kind: "replay" | "batch";
        source: string;
        total: number;
        passed: number;
        failed: number;
        healedCount: number;
        durationMs: number;
    }[];
    run?: undefined;
    file?: undefined;
    bytes?: undefined;
    format?: undefined;
} | {
    run: RunRecord;
    runs?: undefined;
    file?: undefined;
    bytes?: undefined;
    format?: undefined;
} | {
    file: string;
    bytes: number;
    runs: number;
    format: string;
    run?: undefined;
}>;
/**
 * 动作批处理:一次调用顺序执行多个浏览器步骤(内核复用 runReplay),
 * 减少「点击→等待→输入」类固定小序列的工具往返。步骤内禁止嵌套
 * batch/replay/record;批整体在操作轨迹里记为一条 browser_batch。
 */
export declare function batchTool(args: Record<string, any>, impls: Record<string, (args: any) => Promise<unknown>>, config?: BrowserConfig): Promise<{
    summary: string;
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
}>;
/** 收集步骤中所有 {{var}} 占位符名(导出供测试)。 */
export declare function findPlaceholders(steps: ReplayStep[]): string[];
/**
 * 深拷贝步骤并替换字符串叶子里的 {{var}} 占位符(导出供测试)。
 * vars 缺失的占位符保留原样(由调用方先 findPlaceholders 校验)。
 */
export declare function substituteVars(steps: ReplayStep[], vars: Record<string, unknown>): ReplayStep[];
/**
 * 回放入口:name(已保存录制)或 steps(数组)二选一。
 * vars 注入 {{占位符}};data/dataFile 数据集模式逐行运行并聚合。
 */
export declare function replayTool(args: Record<string, any>, impls: Record<string, (args: any) => Promise<unknown>>, config?: BrowserConfig, exec?: ToolRunContext): Promise<{
    source: string;
    rows: number;
    passedRows: number;
    failedRows: number;
    runs: any[];
    summary: string;
} | {
    summary: string;
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
    source: string;
    rows?: undefined;
    passedRows?: undefined;
    failedRows?: undefined;
    runs?: undefined;
}>;
//# sourceMappingURL=tools.d.ts.map