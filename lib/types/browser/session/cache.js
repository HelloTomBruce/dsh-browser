// ---------------------------------------------------------------------------
// ARIA 快照 ref 注册表:page → (ref → 定位信息)。页面导航即失效(防漂移)。
// ---------------------------------------------------------------------------
const refRegistry = new WeakMap();
/** 记录一次 aria 快照分配的 ref(整表替换)。 */
export function setPageRefs(page, refs) {
    refRegistry.set(page, refs);
}
/** 查询某个 ref 的定位信息;未注册返回 undefined。 */
export function pageRef(page, ref) {
    return refRegistry.get(page)?.get(ref);
}
/** 清空页面的 ref 表(导航/新快照时调用)。 */
export function clearPageRefs(page) {
    refRegistry.delete(page);
}
/** 取页面当前完整 ref 表(browser_find 增量续号合并用;无则空 Map)。 */
export function pageRefsOf(page) {
    return refRegistry.get(page) ?? new Map();
}
const snapshotCaches = new WeakMap();
export function snapshotCacheOf(page) {
    return snapshotCaches.get(page);
}
export function setSnapshotCache(page, cache) {
    snapshotCaches.set(page, cache);
}
/** 环形容量钳制(1..20,非法值回落默认 5)。导出供测试。 */
export function snapshotCapacity(k) {
    const n = Math.floor(Number(k));
    if (!Number.isFinite(n))
        return 5;
    return Math.min(Math.max(n, 1), 20);
}
/**
 * 追加一个新版本并淘汰超限的最旧版本(纯逻辑,导出供测试)。
 * cache 为 undefined 时从 version 1 开始;返回新缓存(不修改入参)。
 */
export function pushSnapshotVersion(cache, content, capacity) {
    const version = (cache?.version ?? 0) + 1;
    const k = snapshotCapacity(capacity);
    const history = [...(cache?.history ?? []), { version, text: content.text, aria: content.aria }];
    if (history.length > k)
        history.splice(0, history.length - k);
    return { version, history };
}
/** 按版本号取历史条目;不在环形窗口内(更旧/未知)返回 undefined。 */
export function snapshotVersionEntry(cache, version) {
    if (cache === undefined)
        return undefined;
    return cache.history[cache.history.length - 1]?.version === version
        ? cache.history[cache.history.length - 1]
        : cache.history.find((e) => e.version === version);
}
//# sourceMappingURL=cache.js.map