import type { BrowserContext, Page } from "playwright-core";
import type { BrowserConfig, ProfileState, DownloadEntry, FormField, NavEntry, RefEntry, ReplayStep, SelectorHint } from "./types.js";
/** 当前活动 profile 名(默认 "default")。 */
export declare let currentProfile: string;
/** 多配置文件浏览器会话:name → 会话状态。 */
export declare const profileStates: Map<string, ProfileState>;
/** 已保存的表单回放:name → fields 数组。 */
export declare const savedForms: Map<string, FormField[]>;
/** 最近一次 browser_form 填充的字段(供 browser_form_save 无参保存)。 */
export declare let lastFormFields: FormField[];
/** 记录一次 aria 快照分配的 ref(整表替换)。 */
export declare function setPageRefs(page: Page, refs: Map<string, RefEntry>): void;
/** 查询某个 ref 的定位信息;未注册返回 undefined。 */
export declare function pageRef(page: Page, ref: string): RefEntry | undefined;
/** 清空页面的 ref 表(导航/新快照时调用)。 */
export declare function clearPageRefs(page: Page): void;
/** 取页面当前完整 ref 表(browser_find 增量续号合并用;无则空 Map)。 */
export declare function pageRefsOf(page: Page): Map<string, RefEntry>;
/** 一个历史版本的快照内容(text/aria 两种模式共用同一条版本序列)。 */
export interface SnapshotEntry {
    version: number;
    text: string;
    aria: string;
}
/**
 * F3 增量快照历史:per-page 环形数组保存最近 K 个版本(K = snapshotHistory,
 * 默认 5,上限 20;text 模式 ≤20KB/版本 → 内存上界 ≈100KB/page)。
 * 任意 since ∈ [latest-K+1, latest] 都能 diff;更旧版本回落全量标 stale。
 */
export interface SnapshotCache {
    /** 最新版本号(单调递增,不因环形淘汰回退)。 */
    version: number;
    /** 最近 K 个版本,按 version 升序;长度 ≤ K。 */
    history: SnapshotEntry[];
}
export declare function snapshotCacheOf(page: Page): SnapshotCache | undefined;
export declare function setSnapshotCache(page: Page, cache: SnapshotCache): void;
/** 环形容量钳制(1..20,非法值回落默认 5)。导出供测试。 */
export declare function snapshotCapacity(k: unknown): number;
/**
 * 追加一个新版本并淘汰超限的最旧版本(纯逻辑,导出供测试)。
 * cache 为 undefined 时从 version 1 开始;返回新缓存(不修改入参)。
 */
export declare function pushSnapshotVersion(cache: SnapshotCache | undefined, content: {
    text: string;
    aria: string;
}, capacity: unknown): SnapshotCache;
/** 按版本号取历史条目;不在环形窗口内(更旧/未知)返回 undefined。 */
export declare function snapshotVersionEntry(cache: SnapshotCache | undefined, version: number): SnapshotEntry | undefined;
/** 已保存的录制脚本:name → 步骤数组。 */
export declare const savedRecordings: Map<string, {
    steps: ReplayStep[];
    savedAt: number;
}>;
/** 一次工具调用的记录(操作轨迹 / 录制 / 回放共用)。 */
export interface TestCall {
    tool: string;
    args: Record<string, any>;
    ok: boolean;
    ms: number;
    ts: number;
    error?: string;
    /** 录制时采集的选择器指纹(回放自愈用;register 包装层异步补齐)。 */
    meta?: {
        hint?: SelectorHint;
        source?: "human";
    };
    /** source: "human" 表示这条来自用户在浏览器中的手动操作(混合录制)。 */
    source?: "human";
}
export declare function isRecording(): boolean;
export declare function startRecording(): void;
export declare function stopRecording(): TestCall[];
/** 最近一次完整录制(start→stop)的 buffer;从未录制过返回 null。 */
export declare function lastRecordingOf(): TestCall[] | null;
/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。返回存入的调用对象(供调用方补 meta)。 */
export declare function recordCall(call: TestCall): TestCall;
/** 操作轨迹(按时间倒序,最新在前)。 */
export declare function testLogOf(): TestCall[];
export declare function setPauseInstruction(instruction: string): void;
export declare function clearPauseInstruction(): void;
export declare function currentPause(): {
    instruction: string;
    startedAt: number;
} | null;
/** 一次待审批的敏感操作(browser_confirm 等待期间供面板展示与提交决策)。 */
export interface PendingConfirm {
    id: string;
    reason: string;
    tool?: string;
    args?: Record<string, any>;
    startedAt: number;
    decision?: "allowed" | "denied";
}
export declare function setPendingConfirm(entry: PendingConfirm): void;
export declare function getPendingConfirm(): PendingConfirm | null;
export declare function clearPendingConfirm(): void;
/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
export declare function resolveConfirm(id: string, decision: "allowed" | "denied"): boolean;
export declare function clearTestLog(): void;
/** live 工具调用开始(register 包装层调用)。 */
export declare function noteToolStart(): void;
/** live 工具调用结束(成功/失败都算结束)。 */
export declare function noteToolEnd(): void;
/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
export declare function activeToolCalls(): number;
/** window 上的回传 binding 名(须为合法 JS 标识符)。 */
export declare const HUMAN_BINDING = "__dshBrowserHumanEvent";
/** agent 即将/刚刚执行了 DOM 操作(register 包装层调用);1.5s 内的页内事件视为工具回声。 */
export declare function noteAgentAction(): void;
/** 导出供测试:距上次 agent 操作是否在去重窗口内。 */
export declare function agentActionRecent(now?: number, windowMs?: number): boolean;
/**
 * 页内人工操作事件 → 录制步骤(纯函数,导出供测试)。
 * payload 由 installHumanRecorder 生成:{ kind, selector, value?, testid?, role?, name?, id?, text?, tag? }。
 * 无法映射(缺 selector / 未知 kind / 空输入)返回 null。
 */
export declare function humanEventToStep(payload: unknown): {
    tool: string;
    args: Record<string, any>;
    meta: {
        hint: SelectorHint;
        source: "human";
    };
} | null;
/**
 * 页内注入的人工操作监听(addInitScript 序列化;每次导航自动重装)。
 * 监听常驻但 node 侧只在录制中生效,关闭录制等价于"移除"。
 * 只上报可交互元素上的 click 与表单控件的 change,避免逐键噪音。
 * F5 收敛:cssPath 等元素描述来自 walker.ts 单一来源(构建期拼装注入),
 * 不再持有内联副本;payload 字段语义与 v0.3 完全一致。
 */
export declare const installHumanRecorder: (payload: unknown) => void;
/** 网络请求/响应记录。 */
export interface NetworkEntry {
    url: string;
    method: string;
    resourceType: string;
    status?: number;
    ok?: boolean;
    failed?: boolean;
    error?: string;
    startedAt: number;
    durationMs?: number;
    /** 请求体(截断,默认记录)。 */
    postData?: string | null;
    /** 响应体(截断,默认记录;SSE 与大响应跳过)。 */
    body?: string | null;
}
export declare function networkEntries(name: string): NetworkEntry[];
export declare function addNetworkEntry(profile: string, entry: NetworkEntry): void;
export declare function clearNetwork(profile: string): void;
export declare function profileConfig(config: BrowserConfig, name: string): BrowserConfig;
export declare function getProfileState(name: string): ProfileState;
export declare function downloadsOf(name: string): DownloadEntry[];
/** 某 profile 的访问历史(按时间先后)。 */
export declare function historyOf(name: string): NavEntry[];
export declare function attachPage(page: Page, config: BrowserConfig): void;
export declare function loadPlaywright(): Promise<typeof import("playwright-core")>;
export declare function launchProfile(name: string, config: BrowserConfig): Promise<void>;
/** 当前 profile 状态(未启动时创建空状态)。 */
export declare function stateOf(): ProfileState;
export interface NamedContext {
    context: BrowserContext;
    pageIds: Set<number>;
    createdAt: number;
}
export declare function namedContextsOf(): Map<string, NamedContext>;
/** 把一个已 attach 的页面注册进 profile 标签表并激活,返回分配的 tab id。 */
export declare function registerTabPage(state: ProfileState, page: Page): number;
/** 新建一个页面(当前 profile 会话未启动时先启动)。 */
export declare function newPage(config: BrowserConfig): Promise<Page>;
/** 返回当前活动页面(没有则新建),并保证浏览器已启动。 */
export declare function getPage(config: BrowserConfig): Promise<Page>;
/** 活动页面(可能为 null,不触发启动)。 */
export declare function activePage(): Page | null;
/** 投影当前 profile 的标签列表。 */
export declare function tabList(): Promise<{
    id: number;
    url: string;
    title: string;
}[]>;
export declare function closeBrowser(): Promise<void>;
/** Best-effort current page identity, safe when nothing is open.title 有界防页面忙时挂起。 */
export declare function pageIdentity(page: Page): Promise<{
    url: string;
    title: string;
}>;
/** 设置最近一次表单填充(供 browser_form_save 无参保存)。 */
export declare function setLastFormFields(fields: FormField[]): void;
/** 切换当前 profile。 */
export declare function setCurrentProfile(name: string): void;
/** 记录最近一次截图目录(截图工具调用时写入)。 */
export declare function noteScreenshotDir(dir: string): void;
/** 定时清扫入口:若已知截图目录则按当前配置清理。 */
export declare function sweepScreenshotDir(opts: {
    maxAgeDays?: number;
    maxCount?: number;
}): number;
/**
 * 清理截图目录里的 .png 文件:按修改时间保留最新的 maxCount 个,
 * 并删除超过 maxAgeDays 天的旧文件。只处理目录直属文件,不递归;
 * 单个文件删除失败(被占用等)静默跳过。返回删除数量。
 */
export declare function cleanupScreenshots(dir: string, opts: {
    maxAgeDays?: number;
    maxCount?: number;
}): number;
//# sourceMappingURL=session.d.ts.map