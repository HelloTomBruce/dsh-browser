import type { BrowserConfig } from "../types.js";
export declare function openTool(configOrArgs: BrowserConfig | Record<string, any>, maybeArgs?: Record<string, any>): Promise<{
    url: string;
    title: string;
    status: string;
}>;
export declare function backTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
export declare function reloadTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
/**
 * 命名隔离上下文:同一浏览器进程内独立 cookies/storage 的"标签组"。
 * 页注册进 profile 标签表(所有既有工具直接可用),context 只做归属记录:
 * list / new(name?, url?) / switch(激活该组的一页,没有则新开) / close(整组关闭)。
 * 持久模式(userDataDir)浏览器只有单一 context,不支持本工具(用 profiles 替代)。
 */
export declare function contextTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    contexts: {
        name: string;
        pages: number;
        active: boolean;
        createdAt: number;
    }[];
    profile: string;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    navigated?: string | undefined;
    created: string;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    switched: string;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    switched: string;
    pages: number;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    closed: string;
    remainingTabs: number;
    contexts?: undefined;
    profile?: undefined;
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
export declare function closeTool(): Promise<{
    closed: boolean;
}>;
//# sourceMappingURL=navigation.d.ts.map