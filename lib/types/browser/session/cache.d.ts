import type { Page } from "playwright-core";
import type { RefEntry } from "../types.js";
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
//# sourceMappingURL=cache.d.ts.map