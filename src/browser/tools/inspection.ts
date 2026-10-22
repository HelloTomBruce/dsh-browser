// dsh-browser · 浏览器工具 — 页面探测、快照与查找
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig, RefEntry } from "../types.js";
import {
  getPage, activePage, setPageRefs, pageRefsOf,
  snapshotCacheOf, setSnapshotCache, pushSnapshotVersion, snapshotVersionEntry,
  noteScreenshotDir, cleanupScreenshots, pageIdentity,
} from "../session.js";
import { safeName as sanitizeName } from "../recordings.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { injectWalker } from "../walker.js";
import { compressText, diffLines, topSuggestions, pngSize, DROPDOWN_OPTION_SELECTOR } from "./common.js";

/**
 * 页内 ARIA 树构建(walker 单一来源:roleOf/nameOf/cssPath/isVisible 与
 * INTERACTIVE/STRUCTURAL 集合来自 walker.ts,构建期拼装注入)。
 * 遍历 DOM:结构角色(navigation/main/form/table/heading…)直接打印;
 * 可交互元素分配 ref=e1..eN 并附稳定 CSS 路径;无语义容器(div/span)穿透。
 * 输出形如 `- button "登录" [ref=e3]` 的缩进树,供纯文本模型定位操作目标。
 */
const buildAriaTree = injectWalker<{ maxRefs: number; scope: string }, {
  tree: string;
  refs: { ref: string; role: string; name: string; selector: string }[];
  truncated: boolean;
  scopeMissing: boolean;
}>((payload, w) => {
  const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible } = w;
  const lines: string[] = [];
  const refs: { ref: string; role: string; name: string; selector: string }[] = [];
  let truncated = false;

  function walk(el: Element, depth: number): void {
    if (truncated) return;
    if (lines.length >= 400 || depth > 10) {
      truncated = true;
      return;
    }
    const role = roleOf(el);
    if (INTERACTIVE.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const ref = refs.length < payload.maxRefs ? `e${refs.length + 1}` : "";
      if (ref !== "") refs.push({ ref, role, name, selector: cssPath(el) });
      const expanded = el.getAttribute("aria-expanded");
      const disabled =
        (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
      lines.push(
        `${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${ref !== "" ? ` [ref=${ref}]` : ""}${expanded !== null ? ` [expanded=${expanded}]` : ""}${disabled ? " [disabled]" : ""}`,
      );
      return; // 可交互元素不再深入(按钮内 svg/span 等是噪音)
    }
    if (STRUCTURAL.has(role)) {
      if (!isVisible(el)) return;
      const name = nameOf(el, role);
      const level = role === "heading" ? ` [level=${el.tagName[1] ?? "1"}]` : "";
      lines.push(`${"  ".repeat(depth)}- ${role}${name !== "" ? ` "${name.replace(/"/g, "'")}"` : ""}${level}`);
      for (const c of Array.from(el.children)) {
        if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth + 1);
      }
      return;
    }
    // 无语义容器:穿透
    for (const c of Array.from(el.children)) {
      if (!SKIP_TAGS.has(c.tagName.toLowerCase())) walk(c, depth);
    }
  }

  if (document.body === null) return { tree: "", refs, truncated: false, scopeMissing: false };
  const root = payload.scope ? document.querySelector(payload.scope) : document.body;
  if (root === null) return { tree: "", refs, truncated: false, scopeMissing: true };
  walk(root, 0);
  return { tree: lines.join("\n"), refs, truncated, scopeMissing: false };
});

/**
 * 页内语义查找:只收集匹配 query 的可交互元素(不构建全量树)。
 * role/name/cssPath/isVisible 与 buildAriaTree 同一来源(walker.ts 单一来源,
 * 构建期拼装注入),语义天然一致,不再需要手工同步副本。
 */
const findInteractive = injectWalker<{ query: string; exact: boolean; scope: string; limit: number }, {
  matches: { role: string; name: string; selector: string; ancestors: string[] }[];
  candidates: { role: string; name: string }[];
  scanned: number;
}>((payload, w) => {
  const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible } = w;

  /** 最近的结构化祖先(区域上下文,帮助区分多命中)。 */
  function ancestorsOf(el: Element): string[] {
    const out: string[] = [];
    let cur: Element | null = el.parentElement;
    while (cur && cur !== document.body && out.length < 3) {
      const role = roleOf(cur);
      if (STRUCTURAL.has(role)) {
        const name = nameOf(cur, role);
        out.push(name !== "" ? `${role} "${name.replace(/"/g, "'")}"` : role);
      }
      cur = cur.parentElement;
    }
    return out;
  }

  const q = payload.query.trim().toLowerCase();
  const matches: { role: string; name: string; selector: string; ancestors: string[] }[] = [];
  const candidates: { role: string; name: string }[] = [];
  let scanned = 0;
  const root = payload.scope ? document.querySelector(payload.scope) : document.body;
  if (root === null) return { matches: [], candidates, scanned: 0 };

  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const role = roleOf(el);
    if (INTERACTIVE.has(role)) {
      if (!isVisible(el)) continue;
      const name = nameOf(el, role);
      const idOrTestid = el.id || el.getAttribute("data-testid") || "";
      let hit = false;
      if (name !== "") {
        const n = name.toLowerCase();
        hit = payload.exact ? n === q : n.includes(q);
      }
      if (!hit && idOrTestid !== "" && idOrTestid.toLowerCase() === q) hit = true;
      scanned += 1;
      if (name !== "" && candidates.length < 50) candidates.push({ role, name });
      if (hit && matches.length < payload.limit) {
        matches.push({ role, name, selector: cssPath(el), ancestors: ancestorsOf(el) });
      }
      continue; // 可交互元素不深入
    }
    for (const c of Array.from(el.children)) {
      if (!SKIP_TAGS.has(c.tagName.toLowerCase())) stack.push(c);
    }
  }
  return { matches, candidates, scanned };
});

/**
 * 为命中元素增量分配 ref:沿用既有注册表的编号继续(不与上次快照冲突),
 * 合并写回;返回带 ref 的命中列表(上限 maxRefs,超出标 truncated)。
 * 导出供测试(纯逻辑,不依赖浏览器)。
 */
export function assignRefs(
  existing: Map<string, RefEntry>,
  matches: { role: string; name: string; selector: string; ancestors: string[] }[],
  maxRefs: number,
): { withRefs: { ref: string; role: string; name: string; selector: string; ancestors: string[] }[]; merged: Map<string, RefEntry>; truncated: boolean } {
  let next = 0;
  for (const key of existing.keys()) {
    const n = Number(key.replace(/^e/, ""));
    if (Number.isFinite(n) && n > next) next = n;
  }
  const merged = new Map(existing);
  const withRefs: { ref: string; role: string; name: string; selector: string; ancestors: string[] }[] = [];
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
  const data = await page.evaluate(findInteractive, {
    query,
    exact: args.exact === true,
    scope: typeof args.scope === "string" && args.scope ? args.scope : "",
    limit: 20,
  });
  const { withRefs, merged, truncated } = assignRefs(pageRefsOf(page), data.matches, maxRefs);
  setPageRefs(page, merged); // 合并(非整表替换):既有 ref 继续有效
  const suggestions = withRefs.length === 0 ? topSuggestions(query, data.candidates) : [];
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
    const data = await page.evaluate(buildAriaTree, { maxRefs, scope });
    if (data.scopeMissing) throw new Error(`scope 未命中: 页面中没有匹配 "${scope}" 的元素`);
    const map = new Map<string, RefEntry>(
      data.refs.map((r) => [r.ref, { role: r.role, name: r.name, selector: r.selector }]),
    );
    setPageRefs(page, map); // 整表替换,旧 ref 即刻失效
    content = data.tree;
    walkerTruncated = data.truncated;
    extra = { refs: data.refs.length };
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
  const buffer = await page.screenshot({ type: "png" });
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
  };
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
        const antItem = el.closest(".ant-form-item");
        const antLabel = antItem?.querySelector(".ant-form-item-label")?.textContent?.trim();
        if (antLabel) return antLabel.replace(/[*：:]\s*$/, "");
        const elItem = el.closest(".el-form-item");
        const elLabel = elItem?.querySelector(".el-form-item__label")?.textContent?.trim();
        if (elLabel) return elLabel.replace(/[*：:]\s*$/, "");
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
