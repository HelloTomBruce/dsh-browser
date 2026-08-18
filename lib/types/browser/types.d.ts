import type { Browser, BrowserContext, Page } from "playwright-core";
export interface BrowserConfig {
    enabled?: boolean;
    channel?: string;
    executablePath?: string;
    headless?: boolean;
    userDataDir?: string;
    profiles?: Record<string, Partial<BrowserConfig>>;
    screenshotDir?: string;
    downloadDir?: string;
    /** 截图保留天数(0 = 不按时间清理)。 */
    screenshotMaxAgeDays?: number;
    /** 截图保留数量上限(0 = 不按数量清理)。 */
    screenshotMaxCount?: number;
    /** 面板嵌入 + 实时画面 API 基路径。 */
    basePath?: string;
    /** 网络记录是否保存请求/响应体(默认 true,截断存储)。 */
    recordBodies?: boolean;
    maxTextChars?: number;
    maxLinks?: number;
    timeoutMs?: number;
}
/** 一个命名 profile 的会话状态。 */
export interface ProfileState {
    browser: Browser | null;
    context: BrowserContext | null;
    persistent: boolean;
    pages: Map<number, Page>;
    activeId: number | null;
    counter: number;
    channel?: string;
}
/** 一次页面下载的记录。 */
export interface DownloadEntry {
    download: {
        saveAs(path: string): Promise<void>;
        suggestedFilename(): string;
        url(): string;
    };
    suggestedFilename: string;
    at: number;
}
/** 一次页面访问(导航)的记录,供实时画面模态框展示访问历史。 */
export interface NavEntry {
    url: string;
    title: string;
    ts: number;
}
/** 表单字段(selector 或 label 二选一)。 */
export interface FormField {
    selector?: string;
    label?: string;
    value?: string;
}
//# sourceMappingURL=types.d.ts.map