import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, RefEntry } from "../types.js";
/**
 * 为命中元素增量分配 ref:沿用既有注册表的编号继续(不与上次快照冲突),
 * 合并写回;返回带 ref 的命中列表(上限 maxRefs,超出标 truncated)。
 * 导出供测试(纯逻辑,不依赖浏览器)。
 */
export declare function assignRefs(existing: Map<string, RefEntry>, matches: {
    role: string;
    name: string;
    selector: string;
    ancestors: string[];
}[], maxRefs: number): {
    withRefs: {
        ref: string;
        role: string;
        name: string;
        selector: string;
        ancestors: string[];
    }[];
    merged: Map<string, RefEntry>;
    truncated: boolean;
};
/**
 * 语义元素定位:按名称(或 id/data-testid)在可交互元素中查找,只返回命中的
 * ref + 区域上下文,不输出全量 aria 树 —— 大页面定位单个目标时 token 开销
 * 远小于 browser_snapshot { mode: "aria" }。返回的 ref 可直接用于
 * click/type/select/press。零命中不抛错,附最相近候选供二次定位。
 */
export declare function findTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    scanned: number;
    url: string;
    title: string;
    truncated?: true | undefined;
    suggestions?: {
        role: string;
        name: string;
        score: number;
    }[] | undefined;
    found: number;
    matches: {
        ref: string;
        role: string;
        name: string;
        ancestors: string[];
    }[];
}>;
export declare function snapshotTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    scope?: string | undefined;
    unchanged: boolean;
    contentVersion: number;
} | {
    url: string;
    title: string;
    truncated: boolean;
    scope?: string | undefined;
    diff: boolean;
    contentVersion: number;
    changedFrom: number | undefined;
    removed: number | undefined;
} | {
    url: string;
    title: string;
    truncated: boolean;
    scope?: string | undefined;
    stale?: boolean | undefined;
    contentVersion: number;
}>;
export declare function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline: string;
} | {
    som?: boolean | undefined;
    somMarks?: {
        id: number;
        role: string;
        name: string;
    }[] | undefined;
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline?: undefined;
}>;
export declare function elementsTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    count: number;
    elements: Record<string, unknown>[];
    dropdownOptions: string[];
}>;
//# sourceMappingURL=inspection.d.ts.map