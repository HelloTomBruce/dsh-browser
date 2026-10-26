// dsh-browser · 浏览器工具 — 页面探测、快照与查找
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, RefEntry } from "../types.js";
import {
  getPage, activePage, setPageRefs, pageRefsOf, pageNavSeq,
  snapshotCacheOf, setSnapshotCache, pushSnapshotVersion, snapshotVersionEntry,
  noteScreenshotDir, cleanupScreenshots, pageIdentity, setPageMarks,
} from "../session.js";
import { scanInteractive } from "../session/semantic.js";
import { assignRefs as assignRefsImpl } from "../session/cache.js";
import { safeName as sanitizeName } from "../recordings.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { injectWalker } from "../walker.js";
import { compressText, diffLines, topSuggestions, pngSize, DROPDOWN_OPTION_SELECTOR, withTimeout } from "./common.js";
import { getActiveDialog } from "../primitives/index.js";

// assignRefs 已下沉到 session/cache.ts(findTool 与语义定位共用);此处re-export
// 保持既有导入路径(../src/browser/tools.js)兼容。
export const assignRefs = assignRefsImpl;

/**
 * 页内 ARIA 树构建(walker 单一来源:roleOf/nameOf/cssPath/isVisible 与
 * INTERACTIVE/STRUCTURAL 集合来自 walker.ts,构建期拼装注入)。
 * 遍历 DOM:结构角色(navigation/main/form/table/heading…)直接打印;
 * 可交互元素分配 ref=e1..eN 并附稳定 CSS 路径;无语义容器(div/span)穿透。
 * 输出形如 `- button "登录" [ref=e3]` 的缩进树,供纯文本模型定位操作目标。
 */
const buildAriaTree = injectWalker<{
  maxRefs: number;
  scope: string;
  viewportOnly?: boolean;
  viewportPadding?: number;
}, {
  tree: string;
  refs: { ref: string; role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number }; scroll?: { x: number; y: number } }[];
  truncated: boolean;
  scopeMissing: boolean;
  prunedCount: number;
}>((payload, w) => {
  const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible, isElementInViewport, deepChildren } = w;
  const lines: string[] = [];
  const refs: { ref: string; role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number }; scroll?: { x: number; y: number } }[] = [];
  let truncated = false;
  let prunedCount = 0;
  const padding = payload.viewportPadding ?? 0;
  // 视口内元素的包围盒与滚动偏移(坐标兜底数据源;视口外元素不记录,控制内存)
  const snapScroll = { x: window.scrollX, y: window.scrollY };

  function walk(el: Element, depth: number): void {
    if (truncated) return;
    if (lines.length >= 400 || depth > 10) {
      truncated = true;
      return;
    }
    // 视口感知剪枝: 当开启 viewportOnly 时，跳过不在视口内的分支
    if (payload.viewportOnly && !isElementInViewport(el, padding)) {
      prunedCount += 1;
      return;
    }

    const role = roleOf(el);
    if (INTERACTIVE.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const ref = refs.length < payload.maxRefs ? `e${refs.length + 1}` : "";
      if (ref !== "") {
        const rect = el.getBoundingClientRect();
        refs.push({
          ref,
          role,
          name,
          selector: cssPath(el),
          ...(isElementInViewport(el, 0)
            ? { rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) }, scroll: snapScroll }
            : {}),
        });
      }
      const expanded = el.getAttribute("aria-expanded");
      const disabled =
        (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
      lines.push(
        `${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${ref !== "" ? ` [ref=${ref}]` : ""}${expanded !== null ? ` [expanded=${expanded}]` : ""}${disabled ? " [disabled]" : ""}`,
      );
      // 复合容器角色 (listbox, menu, tablist, tree, grid 等) 需要继续递归其子选项条目
      if (["listbox", "menu", "menubar", "tablist", "tree", "grid"].includes(role)) {
        for (const c of deepChildren(el)) {
          if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth + 1);
        }
      }
      return; // 其它原子级可交互元素不再深入(按钮内 svg/span 等是噪音)
    }
    if (STRUCTURAL.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const level = role === "heading" ? ` [level=${el.tagName[1] ?? "1"}]` : "";
      const isDialog =
        role === "dialog" ||
        role === "alertdialog" ||
        el.getAttribute("aria-modal") === "true";
      const dialogFlag = isDialog ? " [modal: closeOnEsc]" : "";
      lines.push(`${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${level}${dialogFlag}`);
      for (const c of deepChildren(el)) {
        if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth + 1);
      }
      return;
    }
    // 无语义容器:穿透
    for (const c of deepChildren(el)) {
      if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth);
    }
  }

  function resolveScopeRoot(scopeStr: string): Element | null {
    if (!scopeStr) return document.body;
    const wantsVisible = /:visible\b/.test(scopeStr);
    const cleanSelector = scopeStr.replace(/:visible\b/g, "").trim() || "*";
    try {
      const list = Array.from(document.querySelectorAll(cleanSelector));
      if (list.length === 0) return null;
      const visibleList = list.filter((el) => isVisible(el));
      if (wantsVisible) {
        return visibleList.length > 0 ? visibleList[visibleList.length - 1] : null;
      }
      return visibleList.length > 0 ? visibleList[visibleList.length - 1] : list[0];
    } catch {
      return null;
    }
  }

  if (document.body === null) return { tree: "", refs, truncated: false, scopeMissing: false, prunedCount: 0 };
  const root: Element | null = resolveScopeRoot(payload.scope);
  if (root === null) return { tree: "", refs, truncated: false, scopeMissing: true, prunedCount: 0 };
  walk(root, 0);
  return { tree: lines.join("\n"), refs, truncated, scopeMissing: false, prunedCount };
});

/**
 * 页内语义扫描已收敛到 session/semantic.ts 的 scanInteractive(walker 单一
 * 来源 + 打分排序),browser_find 与 what 语义定位共用同一匹配语义。
 */

/**
 * 语义元素定位:按名称(或 id/data-testid)在可交互元素中查找,只返回命中的
 * ref + 区域上下文,不输出全量 aria 树 —— 大页面定位单个目标时 token 开销
 * 远小于 browser_snapshot { mode: "aria" }。返回的 ref 可直接用于
 * click/type/select/press。零命中不抛错,附最相近候选供二次定位。
 */
export async function findTool(config: BrowserConfig, args: Record<string, any>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("缺少 query: 要找的元素名称(如「提交」「登录」,或 id/data-testid)");
  }
  const page = await getPage(config);
  const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
  const data = await page.evaluate(scanInteractive, {
    query,
    exact: args.exact === true,
    scope: typeof args.scope === "string" && args.scope ? args.scope : "",
    limit: 20,
  });
  const { withRefs, merged, truncated } = assignRefs(pageRefsOf(page), data.matches, maxRefs, pageNavSeq(page));
  setPageRefs(page, merged); // 合并(非整表替换):既有 ref 继续有效
  const suggestions = withRefs.length === 0
    ? topSuggestions(query, data.candidates.map(({ role, name }) => ({ role, name })))
    : [];
  return {
    found: withRefs.length,
    matches: withRefs.slice(0, 10).map(({ ref, role, name, ancestors }) => ({ ref, role, name, ancestors })),
    ...(suggestions.length > 0 ? { suggestions } : {}),
    ...(truncated ? { truncated } : {}),
    scanned: data.scanned,
    url: page.url(),
    title: await page.title(),
  };
}

export async function snapshotTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const maxText = args.maxTextChars ?? config.maxTextChars;
  const scope = typeof args.scope === "string" && args.scope ? args.scope : "";
  const since = args.since !== undefined ? Number(args.since) : undefined;
  const ariaMode = args.mode === "aria";
  const viewportOnly = args.viewportOnly === true;
  const viewportPadding = Number(args.viewportPadding ?? 0) || 0;
  const identity = { url: page.url(), title: await page.title() };

  // 增量模式(F3 历史版本):since 命中环形窗口内任一保留版本 → 未变返回
  // unchanged,变了只返回相对该版本的行级 diff;更旧/未知版本回落全量标 stale。
  const cache = snapshotCacheOf(page);
  const capacity = config.snapshotHistory ?? 5;
  const base = since !== undefined ? snapshotVersionEntry(cache, since) : undefined;
  const canDiff = base !== undefined;

  let content: string; // 本次的规范化文本(text 模式压缩后 / aria 模式树)
  let extra: Record<string, unknown> = {};
  let walkerTruncated = false;
  if (ariaMode) {
    const maxRefs = Math.min(Math.max(Number(args.maxRefs ?? config.maxRefs ?? 200) || 200, 1), 500);
    const mainFrame = page.mainFrame();
    const data = await mainFrame.evaluate(buildAriaTree, { maxRefs, scope, viewportOnly, viewportPadding });
    if (data.scopeMissing) {
      const isDialogScope = /modal|dialog|drawer/i.test(scope);
      let hint = isDialogScope
        ? "。目标容器可能已消失（弹窗/抽屉已关闭、已提交或页面已导航）"
        : "";
      if (isDialogScope && typeof page.locator === "function") {
        try {
          // 从适配器层动态查询当前活动弹窗/抽屉容器，避免在通用工具层硬编码组件库类名
          const activeDialogLoc = getActiveDialog(page);
          const count = typeof activeDialogLoc?.count === "function"
            ? await withTimeout(activeDialogLoc.count(), 1000, "活动弹窗探测").catch(() => 0)
            : 0;
          if (count > 0 && typeof activeDialogLoc.first === "function") {
            const alternate = await withTimeout(
              activeDialogLoc.first().evaluate((el) => {
                const role = el.getAttribute("role");
                if (role === "dialog") return "[role='dialog']";
                const cls = el.className;
                if (typeof cls === "string" && cls.trim()) {
                  const parts = cls.trim().split(/\s+/);
                  const relevant = parts.find((c) => /modal|dialog|drawer/i.test(c)) || parts[0];
                  return `.${relevant}`;
                }
                return el.tagName.toLowerCase();
              }),
              1000,
              "解析活动弹窗标识",
            ).catch(() => null);
            if (alternate) {
              hint += ` (检测到当前页面存在「${alternate}」容器，可能混淆了弹窗与抽屉类型)`;
            }
          }
        } catch {
          // 容错探测静默捕获，确保不阻断主错误抛出
        }
      }
      throw new Error(`scope 未命中: 页面中没有匹配 "${scope}" 的元素${hint}`);
    }
    const map = new Map<string, RefEntry>(
      data.refs.map((r) => [r.ref, { role: r.role, name: r.name, selector: r.selector, ...(r.rect !== undefined ? { rect: r.rect } : {}), ...(r.scroll !== undefined ? { scroll: r.scroll } : {}), frameIndex: 0, frameUrl: page.url(), navSeq: pageNavSeq(page) }]),
    );
    let finalTree = data.tree;
    let prunedTotal = data.prunedCount;

    // 跨 Frame 树合成与去重 (支持 dedupeFrames 自动折叠重复镜像、ignoreFrames 过滤指定框架)
    const ignoreFrames = Array.isArray(args.ignoreFrames) ? args.ignoreFrames.map(String) : [];
    const dedupeFrames = args.dedupeFrames !== false;
    const seenTrees = new Map<string, string>(); // treeFingerprint -> firstFrameTitle

    // 仅在未限定特定 scope 且未显式关闭 frames 时遍历子 frame
    if (!scope && args.frames !== false) {
      const frames = page.frames();
      for (let fIdx = 1; fIdx < frames.length; fIdx++) {
        const sub = frames[fIdx];
        if (sub.isDetached()) continue;
        const frameName = sub.name() || "";
        const frameUrl = sub.url() || "";
        const frameTitle = frameName || frameUrl || `frame-${fIdx}`;

        // 检查 ignoreFrames 过滤规则
        if (
          ignoreFrames.some(
            (ig) =>
              (frameName && frameName.includes(ig)) ||
              (frameUrl && frameUrl.includes(ig)) ||
              frameTitle.includes(ig),
          )
        ) {
          continue;
        }

        try {
          const subData = await withTimeout(
            sub.evaluate(buildAriaTree, { maxRefs: 50, scope: "", viewportOnly, viewportPadding }),
            2000,
            "子 Frame 遍历",
          );
          if (subData && subData.tree && subData.tree.trim()) {
            const rawTree = subData.tree.trim();
            // 内容指纹（去除 ref 编号影响后判断是否镜像内容）
            const treeFingerprint = rawTree.replace(/\[ref=e\d+\]/g, "");

            if (dedupeFrames && seenTrees.has(treeFingerprint)) {
              const original = seenTrees.get(treeFingerprint)!;
              finalTree += `\n--- [frame: ${frameTitle}] (同 ${original} 镜像内容,已去重折叠) ---`;
              continue;
            }

            seenTrees.set(treeFingerprint, frameTitle);
            const subTreeAdjusted = subData.tree.replace(/\[ref=(e\d+)\]/g, `[ref=f${fIdx}:$1]`);
            finalTree += `\n--- [frame: ${frameTitle}] ---\n${subTreeAdjusted}\n------------------------------`;
            prunedTotal += subData.prunedCount;
            for (const r of subData.refs) {
              map.set(`f${fIdx}:${r.ref}`, {
                role: r.role,
                name: r.name,
                selector: r.selector,
                ...(r.rect !== undefined ? { rect: r.rect } : {}),
                ...(r.scroll !== undefined ? { scroll: r.scroll } : {}),
                frameIndex: fIdx,
                frameUrl: sub.url(),
                navSeq: pageNavSeq(page),
              });
            }
          }
        } catch {
          // 忽略跨域访问受限或销毁的 Frame
        }
      }
    }

    setPageRefs(page, map); // 整表替换,旧 ref 即刻失效
    content = finalTree;
    walkerTruncated = data.truncated;
    extra = {
      refs: map.size,
      ...(viewportOnly ? { viewportOnly: true, prunedCount: prunedTotal } : {}),
    };
  } else {
    const maxLinks = args.maxLinks ?? config.maxLinks;
    const data = await page.evaluate(
      (payload: { maxL: number; sc: string }) => {
        const root = payload.sc ? document.querySelector(payload.sc) : document.body;
        const text = root instanceof HTMLElement ? root.innerText : "";
        const scopeEl = root ?? document;
        const links = Array.from(scopeEl.querySelectorAll("a"))
          .slice(0, payload.maxL)
          .map((a) => ({
            text: (a.innerText || a.textContent || "").trim().slice(0, 200),
            href: a.href,
          }));
        const inputs = scopeEl.querySelectorAll("input, textarea, select").length;
        const scopeMissing = payload.sc !== "" && root === null;
        return { text, links, inputs, scopeMissing };
      },
      { maxL: maxLinks, sc: scope },
    );
    if (data.scopeMissing) throw new Error(`scope 未命中: 页面中没有匹配 "${scope}" 的元素`);
    content = compressText(data.text);
    extra = { links: data.links, inputs: data.inputs };
  }

  const key = ariaMode ? "aria" : "text";
  if (canDiff && base![key] === content) {
    return { unchanged: true, contentVersion: cache!.version, ...(scope !== "" ? { scope } : {}), ...identity, ...extra };
  }
  if (canDiff) {
    const d = diffLines(base![key], content);
    // 另一模式的内容沿用最新版本的记录(与 v0.3 语义一致:两模式共用版本序列)。
    const latest = cache!.history[cache!.history.length - 1];
    const next = pushSnapshotVersion(
      cache,
      { text: ariaMode ? latest.text : content, aria: ariaMode ? content : latest.aria },
      capacity,
    );
    setSnapshotCache(page, next);
    if (d.unchanged) {
      return { unchanged: true, contentVersion: next.version, ...(scope !== "" ? { scope } : {}), ...identity, ...extra };
    }
    return {
      diff: true,
      contentVersion: next.version,
      changedFrom: d.changedFrom,
      removed: d.removed,
      ...(scope !== "" ? { scope } : {}),
      [ariaMode ? "tree" : "text"]: (d.lines ?? []).join("\n").slice(0, maxText),
      truncated: false,
      ...identity,
      ...extra,
    };
  }
  // 全量(不传 since,或 since 超出历史窗口 → 回落全量并附 stale 提示)
  const latestEntry = cache?.history[cache.history.length - 1];
  const next = pushSnapshotVersion(
    cache,
    { text: ariaMode ? (latestEntry?.text ?? "") : content, aria: ariaMode ? content : (latestEntry?.aria ?? "") },
    capacity,
  );
  setSnapshotCache(page, next);
  return {
    contentVersion: next.version,
    ...(since !== undefined ? { stale: true } : {}),
    ...(scope !== "" ? { scope } : {}),
    [ariaMode ? "tree" : "text"]: content.slice(0, maxText),
    truncated: ariaMode ? walkerTruncated || content.length > maxText : content.length > maxText,
    ...identity,
    ...extra,
  };
}

const removeSomOverlay = () => {
  document.getElementById("__dsh_som_overlay__")?.remove();
};

const injectSomOverlay = injectWalker<{ maxMarks: number; color: string }, Array<{
  id: number;
  role: string;
  name: string;
  selector: string;
  rect?: { x: number; y: number; w: number; h: number };
  scroll?: { x: number; y: number };
}>>((payload, w) => {
  const { INTERACTIVE, roleOf, nameOf, cssPath, isVisible, isElementInViewport, deepChildren, isProbablyClickable } = w;
  const marks: Array<{ id: number; role: string; name: string; selector: string; rect?: { x: number; y: number; w: number; h: number }; scroll?: { x: number; y: number } }> = [];
  const snapScroll = { x: window.scrollX, y: window.scrollY };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "__dsh_som_overlay__";
  svg.setAttribute("style", "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;");

  const candidates: Element[] = [];
  function collect(el: Element): void {
    const role = roleOf(el);
    if (INTERACTIVE.has(role) && isVisible(el) && isElementInViewport(el, 0)) {
      candidates.push(el);
      return;
    }
    // 疑似可点击 generic 元素(span+click 等)同样进标徽——与 what 扫描同一 walker
    // 判定,防止"what 找不到、标徽也没有"的分叉;仍下钻子树。
    if (isVisible(el) && isElementInViewport(el, 0) && isProbablyClickable(el)) {
      candidates.push(el);
    }
    for (const c of deepChildren(el)) {
      if (c.tagName !== "SCRIPT" && c.tagName !== "STYLE") collect(c);
    }
  }

  if (document.body) collect(document.body);

  const badgeColor = payload.color === "blue" ? "#1890ff" : payload.color === "green" ? "#52c41a" : "#ff4d4f";
  let count = 0;

  for (const el of candidates) {
    if (count >= payload.maxMarks) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    count += 1;
    const realRole = roleOf(el);
    // 疑似可点击 generic 元素以伪角色 "clickable" + 文本入标徽(与 what 扫描同语义)
    const role = realRole === "" ? "clickable" : realRole;
    const name =
      realRole === ""
        ? ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60)
        : nameOf(el, realRole);

    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rectEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rectEl.setAttribute("x", String(x));
    rectEl.setAttribute("y", String(y));
    rectEl.setAttribute("width", count >= 10 ? "24" : "18");
    rectEl.setAttribute("height", "18");
    rectEl.setAttribute("rx", "3");
    rectEl.setAttribute("fill", badgeColor);
    rectEl.setAttribute("opacity", "0.92");

    const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    textEl.setAttribute("x", String(x + (count >= 10 ? 12 : 9)));
    textEl.setAttribute("y", String(y + 13));
    textEl.setAttribute("fill", "#ffffff");
    textEl.setAttribute("font-size", "11");
    textEl.setAttribute("font-weight", "bold");
    textEl.setAttribute("text-anchor", "middle");
    textEl.setAttribute("font-family", "sans-serif");
    textEl.textContent = String(count);

    g.appendChild(rectEl);
    g.appendChild(textEl);
    svg.appendChild(g);

    marks.push({
      id: count,
      role,
      name,
      selector: cssPath(el),
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      scroll: snapScroll,
    });
  }

  document.documentElement.appendChild(svg);
  return marks;
});

export async function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  const cwd = workspaceBaseDir(config, exec);
  // baseline 模式:写入基线目录(.dsh-browser/baselines),不受截图清理策略约束。
  if (typeof args.baseline === "string" && args.baseline !== "") {
    const baselineName = sanitizeName(args.baseline);
    const baselineDir = config.baselineDir ?? ".dsh-browser/baselines";
    const dir = isAbsolute(baselineDir) ? baselineDir : resolve(cwd, baselineDir);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${baselineName}.png`);
    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(filePath, buffer);
    const size = pngSize(buffer);
    return {
      path: filePath,
      bytes: buffer.length,
      width: size.width,
      height: size.height,
      baseline: baselineName,
    };
  }
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const dir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
  mkdirSync(dir, { recursive: true });
  const safeName = String(args.name ?? `shot-${Date.now()}`).replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
  const fileName = safeName.endsWith(".png") ? safeName : `${safeName}.png`;
  const filePath = join(dir, fileName);

  let somMarks: Array<{ id: number; role: string; name: string; selector?: string; rect?: unknown; scroll?: unknown }> | undefined = undefined;
  if (args.som === true) {
    try {
      somMarks = await page.evaluate(injectSomOverlay, {
        maxMarks: Number(args.maxMarks ?? 50) || 50,
        color: String(args.somColor ?? "red"),
      });
      // 标徽注册(click { mark: N } 消费;含 selector/rect 供定位与坐标兜底),
      // 页面导航即失效(与 ref 注册表同生命周期)。
      setPageMarks(
        page,
        new Map(
          (somMarks ?? [])
            .filter((m) => typeof m.selector === "string" && m.selector !== "")
            .map((m) => [m.id, { role: m.role, name: m.name, selector: m.selector as string, ...(m.rect ? { rect: m.rect as any } : {}), ...(m.scroll ? { scroll: m.scroll as any } : {}) }]),
        ),
      );
    } catch {
      /* ignore */
    }
  }

  let buffer: Buffer;
  try {
    buffer = await page.screenshot({ type: "png" });
  } finally {
    if (args.som === true) {
      await Promise.resolve(page.evaluate(removeSomOverlay)).catch(() => {});
    }
  }

  writeFileSync(filePath, buffer);
  // 懒清理:按保留天数/数量修剪目录,并把目录记下供定时清扫复用。
  noteScreenshotDir(dir);
  cleanupScreenshots(dir, {
    maxAgeDays: config.screenshotMaxAgeDays,
    maxCount: config.screenshotMaxCount,
  });
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  return {
    path: filePath,
    bytes: buffer.length,
    width: viewport.width,
    height: viewport.height,
    ...(somMarks ? { som: true, somMarks: somMarks.map(({ id, role, name }) => ({ id, role, name })) } : {}),
  };
}

/**
 * 语义定位零命中时的 SoM 兜底截图(clickTool 失败路径调用,somFallback 配置
 * 控制):截一张带标徽的视口图,供多模态模型看图后 browser_click { mark: N }
 * 一次往返完成定位。无活动页面或截图失败返回 null(不放大错误)。
 */
export async function somFallbackShot(
  config: BrowserConfig,
  exec?: ToolRunContext,
): Promise<{ screenshot: string; marks: Array<{ id: number; role: string; name: string }> } | null> {
  try {
    const page = activePage();
    if (page === null) return null;
    const res: any = await screenshotTool(config, { som: true, name: `som-miss-${Date.now()}` }, exec);
    if (typeof res?.path !== "string") return null;
    return { screenshot: res.path, marks: Array.isArray(res.somMarks) ? res.somMarks : [] };
  } catch {
    return null;
  }
}

export async function elementsTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const max = Math.min(Math.max(Number(args.max ?? 60) || 60, 1), 200);
  const data = await page.evaluate(
    ([maxN, optionSelector]) => {
      /** 提取元素的关联 label:aria-label → label[for] → form-item 标签(antd/element)。 */
      function labelOf(el: HTMLElement): string {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        if (el.id) {
          const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          const text = forLabel?.textContent?.trim();
          if (text) return text;
        }
        const formItem = el.closest("[class*='-form-item'], [class*='__form-item'], form, .form-group");
        const formLabel = formItem?.querySelector("[class*='label'], label")?.textContent?.trim();
        if (formLabel) return formLabel.replace(/[*：:]\s*$/, "");
        return "";
      }
      const out: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      const nodes = Array.from(
        document.querySelectorAll("input, textarea, select, button, a[href]"),
      ) as HTMLElement[];
      for (const el of nodes) {
        if (out.length >= maxN) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const info = {
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type ?? "",
          name: (el as HTMLInputElement).name ?? "",
          id: el.id ?? "",
          label: labelOf(el),
          placeholder: (el as HTMLInputElement).placeholder ?? "",
          ariaLabel: el.getAttribute("aria-label") ?? "",
          text: (el.innerText || el.textContent || "").trim().slice(0, 80),
          href: (el as HTMLAnchorElement).href ?? "",
          selector:
            el.id !== ""
              ? `#${CSS.escape(el.id)}`
              : (el as HTMLInputElement).name !== ""
                ? `${el.tagName.toLowerCase()}[name="${(el as HTMLInputElement).name}"]`
                : "",
        };
        const key = `${info.tag}|${info.name}|${info.id}|${info.placeholder}|${info.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(info);
      }
      // 展开中的组件库下拉:把可见选项一并列出(agent 无需再 eval 探查)。
      const dropdownOptions = Array.from(document.querySelectorAll(optionSelector))
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 50);
      return { elements: out, dropdownOptions };
    },
    [max, DROPDOWN_OPTION_SELECTOR] as const,
  );
  return { count: data.elements.length, elements: data.elements, dropdownOptions: data.dropdownOptions };
}
