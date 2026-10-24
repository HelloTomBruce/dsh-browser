// dsh-browser · 语义目标解析(what 参数)
// ---------------------------------------------------------------------------
// 目标:browser_click { what: "登录" } 一次调用替代 snapshot → find → click
// 三轮往返。实现为「页内打分扫描 + ref 注册」:
//   1. scanInteractive(页内,walker 单一来源):按 query 分词打分收集可交互
//      元素,弹窗内/可见/高分优先排序 —— 同时是 browser_find 的扫描引擎
//      (单一实现,匹配语义不分叉);
//   2. resolveSemanticTarget(Node 侧):扫描 → 命中注册成正式 ref(增量续号)
//      → 返回标准 TargetResolution;零命中返回带分数的最相近候选。
//
// 依赖方向:只 import 叶子模块(walker / primitives/dialog / ./cache /
// ../tools/common),不 import session facade 或 tools/inspection,避免循环。
// ---------------------------------------------------------------------------
import type { Locator, Page } from "playwright-core";
import { injectWalker } from "../walker.js";
import { ACTIVE_DIALOG_SELECTORS } from "../primitives/dialog.js";
import { assignRefs, pageRefsOf, setPageRefs } from "./cache.js";
import { lcsScore } from "../tools/common.js";
import type { TargetResolution } from "../types.js";

/** 页内扫描命中的元素(带打分与上下文)。 */
export interface SemanticMatch {
  role: string;
  name: string;
  selector: string;
  text: string;
  visible: boolean;
  inDialog: boolean;
  /** 命中得分:name 命中权重 3 / testid·id 2 / text·role 1,多 token 求和;传统子串命中加基础分。 */
  score: number;
  ancestors: string[];
}

/** 语义未命中时返回的最相近候选。 */
export interface SemanticCandidate {
  role: string;
  name: string;
  selector: string;
  score: number;
}

/** 语义未命中结果(与 TargetResolution 用 "candidates" 字段区分)。 */
export interface SemanticMiss {
  what: string;
  candidates: SemanticCandidate[];
}

/**
 * 页内语义扫描:按 query 打分收集可交互元素(弹窗内优先、可见优先、高分优先)。
 * 匹配语义与 browser_find 完全一致(去空白归一化支持 antd「确 定」分词);
 * 多 token(空格/中英混排拆分)按 AND 命中 —— 单 token 行为与旧子串匹配等价。
 */
export const scanInteractive = injectWalker<
  { query: string; exact: boolean; scope: string; limit: number; dialogSelector?: string },
  { matches: SemanticMatch[]; candidates: { role: string; name: string; selector: string }[]; scanned: number }
>((payload, w) => {
  const { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible, deepChildren, composedParent } = w;

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

  /** 最近的结构化祖先(区域上下文,帮助区分多命中)。 */
  function ancestorsOf(el: Element): string[] {
    const out: string[] = [];
    let cur: Element | null = composedParent(el);
    while (cur && cur !== document.body && out.length < 3) {
      const role = roleOf(cur);
      if (STRUCTURAL.has(role)) {
        const name = nameOf(cur, role);
        out.push(name !== "" ? `${role} "${name.replace(/"/g, "'")}"` : role);
      }
      cur = composedParent(cur);
    }
    return out;
  }

  /** query 分词:CJK 逐字 / [a-zA-Z0-9_-]+ 词 / 单个非空白字符。 */
  function tokenize(q: string): string[] {
    const out: string[] = [];
    const re = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[a-zA-Z0-9_-]+|[^\s]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) out.push(m[0].toLowerCase());
    return out;
  }

  const q = payload.query.trim().toLowerCase();
  const qStripped = q.replace(/\s+/g, "");
  const tokens = tokenize(payload.query.trim());
  const dialogSel = payload.dialogSelector ?? "";

  const hits: SemanticMatch[] = [];
  const candidates: { role: string; name: string; selector: string }[] = [];
  let scanned = 0;
  const root: Element | null = resolveScopeRoot(payload.scope);
  if (root === null) return { matches: [], candidates, scanned: 0 };

  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const role = roleOf(el);
    if (INTERACTIVE.has(role)) {
      if (!isVisible(el)) continue;
      const name = nameOf(el, role);
      const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "";
      const idOrTestid = el.id || testid;
      const text = ((el as HTMLElement).innerText || el.textContent || "").trim().slice(0, 60);

      // 传统命中(与旧 findInteractive 语义一致):name 子串(含去空白归一化)或 id/testid 精确
      let legacyHit = false;
      if (name !== "") {
        const n = name.toLowerCase();
        const nStripped = n.replace(/\s+/g, "");
        legacyHit = payload.exact
          ? n === q || (qStripped !== "" && nStripped === qStripped)
          : n.includes(q) || (qStripped !== "" && nStripped.includes(qStripped));
      }
      if (!legacyHit && idOrTestid !== "") {
        const idLower = idOrTestid.toLowerCase();
        legacyHit = idLower === q || (qStripped !== "" && idLower.replace(/\s+/g, "") === qStripped);
      }

      // token 打分:全部 token 都能命中(AND)才算;每个 token 取字段最高权重
      let score = legacyHit ? 100 : 0;
      let tokenHit = true;
      for (const t of tokens) {
        const nRaw = name.toLowerCase();
        const nStr = nRaw.replace(/\s+/g, "");
        const tStr = t.replace(/\s+/g, "");
        const inName = nRaw.includes(t) || (tStr !== "" && nStr.includes(tStr));
        const inIds = idOrTestid.toLowerCase().includes(t) || testid.toLowerCase().includes(t);
        const inText = text.toLowerCase().includes(t);
        const inRole = role === t;
        if (inName) score += 3;
        else if (inIds) score += 2;
        else if (inText) score += 1;
        else if (inRole) score += 1;
        if (!inName && !inIds && !inText && !inRole) {
          tokenHit = false;
          break;
        }
      }
      const hit = payload.exact ? legacyHit : legacyHit || (tokens.length > 0 && tokenHit);
      if (legacyHit && name !== "" && name.toLowerCase() === q) score += 50; // 全名精确最强

      scanned += 1;
      if (name !== "" && candidates.length < 50) candidates.push({ role, name, selector: cssPath(el) });
      if (hit && hits.length < 100) {
        hits.push({
          role,
          name,
          selector: cssPath(el),
          text,
          visible: true, // INTERACTIVE 分支已过滤不可见
          inDialog: dialogSel !== "" ? Boolean(el.closest(dialogSel)) : false,
          score,
          ancestors: ancestorsOf(el),
        });
      }
      continue; // 可交互元素不深入
    }
    for (const c of deepChildren(el)) {
      if (!SKIP_TAGS.has(c.tagName.toLowerCase())) stack.push(c);
    }
  }

  // 排序:弹窗内优先(防穿透) → 得分降序 → 截断到 limit
  hits.sort((a, b) => (Number(b.inDialog) - Number(a.inDialog)) || (b.score - a.score));
  return { matches: hits.slice(0, payload.limit), candidates, scanned };
});

/**
 * 语义未命中时候选排序(纯逻辑,导出供测试):按与 query 的最长公共子串
 * 打分取 top5,阈值与 topSuggestions 一致(短 query ≥1,长 query ≥2)。
 */
export function semanticMissCandidates(
  query: string,
  candidates: { role: string; name: string; selector: string }[],
  count = 5,
): SemanticCandidate[] {
  const min = query.trim().length <= 3 ? 1 : 2;
  return candidates
    .map((c) => ({ role: c.role, name: c.name, selector: c.selector, score: lcsScore(query, c.name) }))
    .filter((c) => c.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

/** 语义未命中的错误消息(候选表内嵌,agent 不必再跑一轮 find)。 */
export function semanticMissMessage(miss: SemanticMiss): string {
  const list = miss.candidates.map((c) => `${c.role} "${c.name}"`);
  return [
    `语义定位未命中: what="${miss.what}"`,
    list.length > 0
      ? `最相近候选(可直接改用其 selector,或 browser_find 精确定位): ${list.join("; ")}`
      : "页面上没有可交互元素命中,也无相近候选(元素可能在 iframe 内或尚未渲染;试试 browser_snapshot)",
  ].join(" — ");
}

/**
 * 意图语义定位:what → 打分扫描 → 命中注册成正式 ref 并返回标准
 * TargetResolution(含 matchedCount/visibleCount,与 selector 路径无缝衔接);
 * 零命中返回 SemanticMiss(候选由调用方决定呈现方式)。
 */
export async function resolveSemanticTarget(
  page: Page,
  what: string,
  opts: { exact?: boolean; scope?: string; limit?: number; maxRefs?: number } = {},
): Promise<TargetResolution | SemanticMiss> {
  const query = what.trim();
  if (query === "") return { what: "", candidates: [] };
  let data: { matches: SemanticMatch[]; candidates: { role: string; name: string; selector: string }[]; scanned: number };
  try {
    data = await page.evaluate(scanInteractive, {
      query,
      exact: opts.exact === true,
      scope: typeof opts.scope === "string" && opts.scope !== "" ? opts.scope : "",
      limit: Math.min(Math.max(opts.limit ?? 5, 1), 20),
      dialogSelector: ACTIVE_DIALOG_SELECTORS,
    });
  } catch {
    return { what: query, candidates: [] };
  }
  if (data.matches.length === 0) {
    return { what: query, candidates: semanticMissCandidates(query, data.candidates) };
  }
  const { withRefs, merged } = assignRefs(pageRefsOf(page), data.matches, Math.min(Math.max(opts.maxRefs ?? 200, 1), 500));
  setPageRefs(page, merged);
  const best = data.matches[0];
  const bestRef = withRefs.length > 0 ? withRefs[0] : undefined;
  const locator: Locator = page.locator(best.selector).first();
  return {
    locator,
    container: page,
    ...(bestRef !== undefined ? { entry: merged.get(bestRef.ref) } : {}),
    isIFrame: false,
    matchedCount: data.matches.length,
    visibleCount: data.matches.filter((m) => m.visible).length,
  };
}
