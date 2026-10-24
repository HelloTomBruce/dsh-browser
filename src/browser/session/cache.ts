// dsh-browser · 会话管理 — 快照缓存与 Ref/Mark 映射
import type { Page } from "playwright-core";
import type { MarkEntry, RefEntry } from "../types.js";

// ---------------------------------------------------------------------------
// ARIA 快照 ref 注册表:page → (ref → 定位信息)。页面导航即失效(防漂移)。
// ---------------------------------------------------------------------------

const refRegistry = new WeakMap<Page, Map<string, RefEntry>>();

/** 记录一次 aria 快照分配的 ref(整表替换)。 */
export function setPageRefs(page: Page, refs: Map<string, RefEntry>): void {
  refRegistry.set(page, refs);
}

/** 查询某个 ref 的定位信息;未注册返回 undefined。 */
export function pageRef(page: Page, ref: string): RefEntry | undefined {
  return refRegistry.get(page)?.get(ref);
}

/** 清空页面的 ref 表(导航/新快照时调用)。 */
export function clearPageRefs(page: Page): void {
  refRegistry.delete(page);
}

/** 取页面当前完整 ref 表(browser_find 增量续号合并用;无则空 Map)。 */
export function pageRefsOf(page: Page): Map<string, RefEntry> {
  return refRegistry.get(page) ?? new Map<string, RefEntry>();
}

/**
 * 为命中元素增量分配 ref:沿用既有注册表的编号继续(不与上次快照冲突),
 * 合并写回;返回带 ref 的命中列表(上限 maxRefs,超出标 truncated)。
 * 纯逻辑不依赖浏览器;findTool 与语义定位(semantic.ts)共用。
 */
export function assignRefs(
  existing: Map<string, RefEntry>,
  matches: { role: string; name: string; selector: string; ancestors?: string[] }[],
  maxRefs: number,
): { withRefs: { ref: string; role: string; name: string; selector: string; ancestors?: string[] }[]; merged: Map<string, RefEntry>; truncated: boolean } {
  let next = 0;
  for (const key of existing.keys()) {
    const n = Number(key.replace(/^e/, ""));
    if (Number.isFinite(n) && n > next) next = n;
  }
  const merged = new Map(existing);
  const withRefs: { ref: string; role: string; name: string; selector: string; ancestors?: string[] }[] = [];
  let truncated = false;
  for (const m of matches) {
    if (merged.size >= maxRefs) {
      truncated = true;
      break;
    }
    next += 1;
    const ref = `e${next}`;
    merged.set(ref, { role: m.role, name: m.name, selector: m.selector });
    withRefs.push({ ref, ...m });
  }
  return { withRefs, merged, truncated };
}

// ---------------------------------------------------------------------------
// SoM 标徽注册表(browser_screenshot { som: true } → click { mark: N }):
// page → (markId → 定位信息)。页面导航即失效(与 ref 注册表同生命周期)。
// ---------------------------------------------------------------------------

const markRegistry = new WeakMap<Page, Map<number, MarkEntry>>();

/** 记录一次 SoM 截图的标徽表(整表替换)。 */
export function setPageMarks(page: Page, marks: Map<number, MarkEntry>): void {
  markRegistry.set(page, marks);
}

/** 查询某个标徽的定位信息;未注册返回 undefined。 */
export function pageMark(page: Page, id: number): MarkEntry | undefined {
  return markRegistry.get(page)?.get(id);
}

/** 清空页面的标徽表(导航时调用)。 */
export function clearPageMarks(page: Page): void {
  markRegistry.delete(page);
}


// ---------------------------------------------------------------------------
// 快照缓存(browser_snapshot 增量模式):per-page 记录最近一次全量内容与版本号,
// since 命中且内容未变 → unchanged;变了 → 行级 diff 只返回变化区域。
// ---------------------------------------------------------------------------

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

const snapshotCaches = new WeakMap<Page, SnapshotCache>();

export function snapshotCacheOf(page: Page): SnapshotCache | undefined {
  return snapshotCaches.get(page);
}

export function setSnapshotCache(page: Page, cache: SnapshotCache): void {
  snapshotCaches.set(page, cache);
}

/** 环形容量钳制(1..20,非法值回落默认 5)。导出供测试。 */
export function snapshotCapacity(k: unknown): number {
  const n = Math.floor(Number(k));
  if (!Number.isFinite(n)) return 5;
  return Math.min(Math.max(n, 1), 20);
}

/**
 * 追加一个新版本并淘汰超限的最旧版本(纯逻辑,导出供测试)。
 * cache 为 undefined 时从 version 1 开始;返回新缓存(不修改入参)。
 */
export function pushSnapshotVersion(
  cache: SnapshotCache | undefined,
  content: { text: string; aria: string },
  capacity: unknown,
): SnapshotCache {
  const version = (cache?.version ?? 0) + 1;
  const k = snapshotCapacity(capacity);
  const history = [...(cache?.history ?? []), { version, text: content.text, aria: content.aria }];
  if (history.length > k) history.splice(0, history.length - k);
  return { version, history };
}

/** 按版本号取历史条目;不在环形窗口内(更旧/未知)返回 undefined。 */
export function snapshotVersionEntry(cache: SnapshotCache | undefined, version: number): SnapshotEntry | undefined {
  if (cache === undefined) return undefined;
  return cache.history[cache.history.length - 1]?.version === version
    ? cache.history[cache.history.length - 1]
    : cache.history.find((e) => e.version === version);
}
