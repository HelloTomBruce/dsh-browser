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
    /** 截图/下载/上传的落盘基准目录(默认探测会话 cwd;显式指定后优先)。 */
    workspaceDir?: string;
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
    /** 视觉回归基线截图目录(默认 .dsh-browser/baselines,不受截图清理策略约束)。 */
    baselineDir?: string;
    /** 回放/批处理时的选择器自愈(默认 true;只作用于失败路径,live 工具不受影响)。 */
    selectorHealing?: boolean;
    /** 自愈时单次尝试的超时毫秒(默认 3000,避免等满全局超时)。 */
    healTimeoutMs?: number;
    /** ARIA 快照每次分配的最大 ref 数(默认 200)。 */
    maxRefs?: number;
    /** browser_extract 单次最多聚合的行数(默认 1000)。 */
    maxRows?: number;
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
/** ARIA 快照分配的 ref 注册项(ref → 定位信息)。 */
export interface RefEntry {
    role: string;
    name: string;
    /** 生成快照时计算的稳定 CSS 路径(优先 #id / [data-testid] / nth-of-type 链)。 */
    selector: string;
}
/** 录制时采集的选择器指纹(回放自愈的降级候选来源)。 */
export interface SelectorHint {
    testid?: string;
    role?: string;
    name?: string;
    id?: string;
    text?: string;
    tag?: string;
}
/** 录制/回放的一步(formatVersion 2 起支持 meta.hint 选择器指纹)。 */
export interface ReplayStep {
    tool: string;
    args: any;
    meta?: {
        hint?: SelectorHint;
    };
}
//# sourceMappingURL=types.d.ts.map