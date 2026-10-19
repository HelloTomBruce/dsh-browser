import type { Page } from "playwright-core";
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
    };
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
export declare function clearTestLog(): void;
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
/** Best-effort current page identity, safe when nothing is open. */
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