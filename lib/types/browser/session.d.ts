import type { BrowserContext, Page } from "playwright-core";
import type { BrowserConfig, ProfileState, DownloadEntry, FormField, NavEntry } from "./types.js";
export * from "./session/cache.js";
export * from "./session/collaboration.js";
export * from "./session/recorder.js";
export * from "./session/screenshot.js";
export * from "./session/target.js";
/** 当前活动 profile 名(默认 "default")。 */
export declare let currentProfile: string;
/** 多配置文件浏览器会话:name → 会话状态。 */
export declare const profileStates: Map<string, ProfileState>;
/** 已保存的表单回放:name → fields 数组。 */
export declare const savedForms: Map<string, FormField[]>;
/** 最近一次 browser_form 填充的字段(供 browser_form_save 无参保存)。 */
export declare let lastFormFields: FormField[];
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
//# sourceMappingURL=session.d.ts.map