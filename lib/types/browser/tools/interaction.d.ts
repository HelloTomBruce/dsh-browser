import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { targetLocator, resolveTargetLocator } from "../session.js";
import type { FormFillResult } from "../adapters/types.js";
export { targetLocator, resolveTargetLocator };
export declare function isBotSensitiveUrl(url: string): boolean;
export declare function clickTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    clicked: string;
}>;
export declare function typeTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    typed: boolean;
    editor: boolean;
    selector: string;
} | {
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
 * 下拉选择原语:委托给 UI 组件库下拉适配器(Native / AntDesign / ElementPlus / GenericARIA)。
 * 各组件库特异性的展开机制、虚拟列表穿透与 0 宽度读屏傀儡节点过滤完全隔离在适配器中。
 */
export declare function selectTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    selected: string;
    selector: string;
}>;
export declare function evalTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    scriptUnwrapped?: boolean | undefined;
    result: unknown;
}>;
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
/**
 * 智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层
 */
export declare function formFillTool(config: BrowserConfig, args: Record<string, any>): Promise<FormFillResult>;
export declare function transferTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    transferred: boolean;
    direction: "left" | "right";
    items: string[];
}>;
export declare function dragTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    dragged: boolean;
    source: string;
    target: string;
}>;
//# sourceMappingURL=interaction.d.ts.map