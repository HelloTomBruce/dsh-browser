import type { Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, ReplayStep, SelectorHint } from "../types.js";
import { type RunRecord } from "../reports.js";
/** 使用 args.selector 定位的工具集合(自愈与录制指纹的作用范围)。 */
export declare const SELECTOR_STEP_TOOLS: Set<string>;
/**
 * 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
 * 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
 * F5 收敛:元素描述(role/name/text)改用 walker 单一来源
 * (describeElement),与 aria 快照/find/录制回声共用同一套语义;相比旧
 * 内联副本,role 推断更完整(slider/spinbutton/searchbox/heading 等),
 * name 补齐 labelledby/label[for]/title 兜底 —— 指纹只作自愈降级候选,
 * 语义增强只会让自愈命中率更高,不改变任何主链路行为。
 */
export declare function captureSelectorHint(page: Page, selector: string): Promise<SelectorHint | null>;
/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
export declare function healCandidates(hint: SelectorHint): {
    via: string;
    selector: string;
}[];
/** 录制管理:start / stop / save / list / delete。 */
export declare function recordTool(args: Record<string, any>, config?: BrowserConfig, exec?: ToolRunContext): Promise<{
    recording: boolean;
    hint: string;
    steps?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
    exported?: undefined;
    format?: undefined;
    path?: undefined;
    code?: undefined;
} | {
    recording: boolean;
    steps: number;
    hint?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
    exported?: undefined;
    format?: undefined;
    path?: undefined;
    code?: undefined;
} | {
    hint: string;
    warnings?: string[] | undefined;
    varsApplied?: number | undefined;
    skippedFailed?: number | undefined;
    stripped?: number | undefined;
    saved: string;
    steps: number;
    source: string;
    file: string;
    recording?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
    exported?: undefined;
    format?: undefined;
    path?: undefined;
    code?: undefined;
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
    exported?: undefined;
    format?: undefined;
    path?: undefined;
    code?: undefined;
} | {
    deleted: boolean;
    name: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    recordings?: undefined;
    exported?: undefined;
    format?: undefined;
    path?: undefined;
    code?: undefined;
} | {
    exported: boolean;
    format: string;
    path: string;
    code: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    exported: boolean;
    format: string;
    code: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
    path?: undefined;
}>;
/** 回放选项(自愈开关与单次尝试超时,来自 config;retryFailed 为自动重试次数)。 */
export interface ReplayOptions {
    healing?: boolean;
    healTimeoutMs?: number;
    /** F2:步骤失败(含自愈链耗尽)后自动重试的次数,步骤间 500ms×n 线性退避。 */
    retryFailed?: number;
}
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
export declare function runReplay(steps: ReplayStep[], impls: Record<string, (args: any) => Promise<unknown>>, failFast: boolean, opts?: ReplayOptions): Promise<{
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    retries?: {
        attempted: number;
        recovered: number;
    };
    stoppedAt?: number;
    results: any[];
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
    retries?: {
        attempted: number;
        recovered: number;
    };
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
    retries?: {
        attempted: number;
        recovered: number;
    };
    stoppedAt?: number;
    results: any[];
    source: string;
    rows?: undefined;
    passedRows?: undefined;
    failedRows?: undefined;
    runs?: undefined;
}>;
/** 重跑请求:source 为已保存录制名,retryOf 为被重跑的原 runId(记录用)。 */
export interface RerunRequest {
    source: string;
    retryOf?: string;
}
type RerunHandler = (req: RerunRequest) => Promise<unknown>;
/** registerTools 注册重跑入口(stepImpls 同路径);web-only 进程保持 null。 */
export declare function setRerunHandler(fn: RerunHandler): void;
/** 当前可用的重跑入口(null = 本进程没有 tools 服务,无法重跑)。 */
export declare function getRerunHandler(): RerunHandler | null;
/** 重跑是否正在执行(端点互斥;导出供测试)。 */
export declare function rerunBusy(): boolean;
/** 执行一次面板重跑(busy 检查 + 互斥标记;返回 replayTool 结果)。 */
export declare function runPanelRerun(req: RerunRequest): Promise<unknown>;
export {};
//# sourceMappingURL=recorder.d.ts.map