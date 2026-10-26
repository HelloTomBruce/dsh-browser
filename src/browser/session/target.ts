// dsh-browser · 统一目标定位解析门面 (Target Resolution Pipeline)
import type { Frame, Locator, Page } from "playwright-core";
import { extractElementLabel, getActiveDialog } from "../primitives/index.js";
import { pageMark, pageRef, pageRefsOf, setPageRefs, pageNavSeq, remapRefs, noteReanchorAttempt, reanchorAttempted } from "./cache.js";
import { withTimeout, lcsScore } from "../tools/common.js";
import { resolveSemanticTarget, semanticMissMessage, scanAllInteractive } from "./semantic.js";
import { injectWalker } from "../walker.js";
import type { TargetResolution } from "../types.js";

/**
 * 构造对字符间/词间任意空白不敏感的匹配正则。
 * 处理中英文混排、单字间隔、Tab、换行以及 &nbsp; 等特殊空白字符。
 */
export function buildFlexibleTextPattern(text: string): RegExp {
  const trimmed = text.trim();
  if (!trimmed) {
    return new RegExp("");
  }
  const tokens: string[] = [];
  const regex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]|[a-zA-Z0-9_-]+|[^\s]/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(trimmed)) !== null) {
    tokens.push(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  if (tokens.length <= 1) {
    return new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  return new RegExp(tokens.join("[\\s\\u00a0]*"), "i");
}

/**
 * 坐标兜底页内探测:按快照时的视口坐标(当前 scroll 修正)elementFromPoint,
 * 从命中点向上爬到最近的可交互元素并返回其统一描述(walker 单一来源)。
 */
const coordinateProbe = injectWalker<
  { x: number; y: number; sx: number; sy: number },
  { selector: string; role: string; name: string } | null
>((payload, w) => {
  const cx = payload.x - (window.scrollX - payload.sx);
  const cy = payload.y - (window.scrollY - payload.sy);
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return null;
  let el: Element | null = document.elementFromPoint(cx, cy);
  // shadow DOM retarget:命中点落在 open shadow 内容上时 elementFromPoint 返回
  // 宿主元素,需进入其 shadowRoot.elementFromPoint 逐层下潜取真实元素
  let dive = 0;
  while (el !== null && el.shadowRoot !== null && dive < 8) {
    const inner = el.shadowRoot.elementFromPoint(cx, cy);
    if (inner === null || inner === el) break;
    el = inner;
    dive += 1;
  }
  let hops = 0;
  while (el !== null && hops < 6) {
    const d = w.describeElement(el);
    if (w.INTERACTIVE.has(d.role)) return { selector: d.selector, role: d.role, name: d.name };
    el = w.composedParent(el);
    hops += 1;
  }
  return null;
});

/** 定位失败页内特征探测(一次 evaluate,best-effort):弹窗激活 + 是否存在 shadow root。 */
const failureContextProbe = injectWalker<unknown, { dialogActive: boolean; hasShadow: boolean }>(() => {
  const dialogSel = "[role='dialog'],[role='alertdialog'],[aria-modal='true'],dialog[open]";
  let hasShadow = false;
  const all = document.querySelectorAll("*");
  for (let i = 0; i < all.length && i < 500; i++) {
    if ((all[i] as Element).shadowRoot !== null) {
      hasShadow = true;
      break;
    }
  }
  return { dialogActive: Boolean(document.querySelector(dialogSel)), hasShadow };
});

/** ref 坐标兜底的名称相似判定:去空白互相包含,或 LCS 占比 ≥ 0.6。 */
function nameSimilar(a: string, b: string): boolean {
  if (a === "" || b === "") return true;
  const clean = (s: string) => s.replace(/[\s\u00a0]+/g, "").toLowerCase();
  const ca = clean(a);
  const cb = clean(b);
  if (ca.includes(cb) || cb.includes(ca)) return true;
  const maxLen = Math.max(a.length, b.length);
  return maxLen > 0 && lcsScore(a, b) / maxLen >= 0.6;
}

/**
 * 统一解析目标元素：
 * 自动识别 selector 或 ref；若 ref 标记位于子 Frame，自动绑定到对应子 Frame 上下文。
 * 具备路径防漂移校验与 getByRole 自愈降级能力。
 */
export async function resolveTargetLocator(
  page: Page,
  args: Record<string, any>,
): Promise<TargetResolution> {
  // 定位参数互斥硬校验:ref/mark/what/selector 四选一。历史上按
  // ref > mark > row > what > selector 静默择一,what 被无声丢弃后报错只字未提,
  // 误导排查方向(实战两次踩坑)。唯一豁免:row/rowText 行级管线可组合 selector
  // (作为行内动作定位);容器内语义定位的正统写法是 what + scope。
  {
    const present: string[] = [];
    if (args.ref !== undefined && args.ref !== "") present.push("ref");
    if (args.mark !== undefined) present.push("mark");
    if (typeof args.what === "string" && args.what.trim() !== "") present.push("what");
    if (args.selector !== undefined && args.selector !== "") present.push("selector");
    const rowGiven = args.rowText !== undefined || args.row !== undefined;
    if (rowGiven && present.some((k) => k !== "selector")) {
      const offending = present.filter((k) => k !== "selector");
      throw new Error(
        `定位参数冲突: row/rowText 与 ${offending.join("、")} 不能同时使用(行级定位仅可组合 selector 限定行内目标);在行内按意图找按钮请用 row + action/actionText`,
      );
    }
    if (present.length >= 2) {
      throw new Error(
        `定位参数冲突: 同时传了 ${present.join(" 与 ")} —— ref/mark/what/selector 四选一;若要在容器内语义定位,请用 what + scope(容器选择器)`,
      );
    }
  }

  if (args.ref !== undefined && args.ref !== "") {
    const ref = String(args.ref);
    const entry = pageRef(page, ref);
    if (entry === undefined) {
      throw new Error(
        `未知 ref: ${ref}(页面导航或重新快照后旧 ref 失效;请先 browser_snapshot { mode: "aria" })`,
      );
    }

    // 判断目标容器：主页面或子 Frame
    let container: Page | Frame = page;
    let isIFrame = false;

    if (typeof entry.frameIndex === "number" && entry.frameIndex > 0) {
      const frames = page.frames();
      const targetFrame = frames[entry.frameIndex];
      if (!targetFrame) {
        throw new Error(
          `引用元素所在的子 Frame (index=${entry.frameIndex}) 已失效或销毁`,
        );
      }
      container = targetFrame;
      isIFrame = true;
    }

    const byPath = container.locator(entry.selector).first();
    const count = await withTimeout(byPath.count(), 3_000, "解析 ref 路径").catch(() => 0);

    if (count > 0) {
      const ok = await withTimeout(
        byPath.evaluate(
          (el, { role, name, labelScript }) => {
            const tag = el.tagName.toLowerCase();
            const type = (el.getAttribute("type") ?? "").toLowerCase();
            const roleAttr = (el.getAttribute("role") ?? "").trim().split(/\s+/)[0] ?? "";
            const roleOk =
              role === "" ||
              roleAttr === role ||
              (role === "link" && tag === "a") ||
              (role === "button" &&
                (tag === "button" ||
                  tag === "summary" ||
                  (tag === "input" && ["button", "submit", "reset", "image"].includes(type)))) ||
              (["textbox", "searchbox"].includes(role) &&
                (tag === "textarea" ||
                  (tag === "input" && !["hidden", "checkbox", "radio"].includes(type)))) ||
              (role === "combobox" && tag === "select") ||
              (role === "checkbox" && tag === "input" && type === "checkbox") ||
              (role === "radio" && tag === "input" && type === "radio");

            const aria = el.getAttribute("aria-label") ?? "";
            const ph = el.getAttribute("placeholder") ?? "";
            const title = el.getAttribute("title") ?? "";
            const text = ((el as HTMLElement).innerText || el.textContent || "")
              .trim()
              .replace(/\s+/g, " ");

            let labelText = "";
            try {
              const labelFn = new Function("el", `return (${labelScript})(el);`);
              labelText = String(labelFn(el) || "");
            } catch {
              /* ignore */
            }

            const clean = (s: string) => s.replace(/[\s\u00a0]+/g, "").toLowerCase();
            const q = clean(name);
            const nameOk =
              name === "" ||
              clean(aria).includes(q) ||
              clean(ph).includes(q) ||
              clean(title).includes(q) ||
              clean(text).includes(q) ||
              clean(labelText).includes(q);

            return roleOk && nameOk;
          },
          {
            role: entry.role,
            name: entry.name,
            labelScript: extractElementLabel.toString(),
          },
        ),
        3_000,
        "校验 ref 元素",
      ).catch(() => false);

      if (ok) {
        return { locator: byPath, container, entry, isIFrame };
      }
    }

    // 降级 1: 若在主页面且有激活的 Modal 弹窗，优先在弹窗容器内检索防穿透
    if (!isIFrame) {
      try {
        const activeDialog = getActiveDialog(page);
        if (activeDialog && typeof activeDialog.getByRole === "function") {
          const inDialog =
            entry.name !== ""
              ? activeDialog.getByRole(entry.role as any, { name: buildFlexibleTextPattern(entry.name) }).first()
              : activeDialog.getByRole(entry.role as any).first();

          if ((await withTimeout(inDialog.count(), 1_000, "弹窗内 role 查找").catch(() => 0)) > 0) {
            return { locator: inDialog, container, entry, isIFrame: false };
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 降级 2: role + name (使用字符间空白容错正则)
    const byRole =
      entry.name !== ""
        ? container.getByRole(entry.role as any, { name: buildFlexibleTextPattern(entry.name) }).first()
        : container.getByRole(entry.role as any).first();

    if ((await withTimeout(byRole.count(), 3_000, "解析 ref role 降级").catch(() => 0)) > 0) {
      return { locator: byRole, container, entry, isIFrame };
    }

    // 降级 3: 坐标兜底 — 路径与 role 降级全部失灵时,按快照时的视口包围盒
    // (当前 scroll 修正)elementFromPoint 重新命中,walker describeElement 校验
    // role/name 相似防误点;校验不过维持「ref 已失效」。
    if (entry.rect !== undefined && entry.scroll !== undefined) {
      try {
        const hit = await withTimeout(
          container.evaluate(coordinateProbe, {
            x: entry.rect.x,
            y: entry.rect.y,
            sx: entry.scroll.x,
            sy: entry.scroll.y,
          }),
          2_000,
          "ref 坐标兜底",
        ).catch(() => null);
        if (hit !== null && hit.role === entry.role && nameSimilar(entry.name, hit.name)) {
          const loc = container.locator(hit.selector).first();
          if ((await withTimeout(loc.count(), 1_000, "坐标兜底定位").catch(() => 0)) > 0) {
            return { locator: loc, container, entry, isIFrame };
          }
        }
      } catch {
        /* ignore */
      }
    }

    // 降级 4: SPA 软失效重锚定 — entry 代际落后于页面当前代际(路由切换而非
    // 整页跳转)且本代际未尝试过时,全量重扫按指纹 remap;命中则用新 selector
    // 再试一次。扫描截断(超大页面)或子 Frame ref 不参与,维持原「已失效」语义。
    if (
      !isIFrame &&
      entry.navSeq !== undefined &&
      entry.navSeq !== pageNavSeq(page) &&
      !reanchorAttempted(page)
    ) {
      noteReanchorAttempt(page);
      try {
        const scan = await withTimeout(page.evaluate(scanAllInteractive, { scope: "" }), 2_500, "重锚定扫描").catch(() => null);
        if (scan !== null && !scan.truncated && scan.elements.length > 0) {
          const { merged } = remapRefs(pageRefsOf(page), scan.elements, pageNavSeq(page));
          setPageRefs(page, merged);
          const reanchored = pageRef(page, ref);
          if (reanchored !== undefined && reanchored.selector !== entry.selector) {
            const loc = container.locator(reanchored.selector).first();
            if ((await withTimeout(loc.count(), 1_500, "重锚定定位").catch(() => 0)) > 0) {
              return { locator: loc, container, entry: reanchored, isIFrame };
            }
          }
        }
      } catch {
        /* 重锚定失败:维持原错误语义 */
      }
    }

    {
      const err = new Error(
        `ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`,
      );
      (err as any).locationFailure = { phase: "staleRef", candidates: 1, dialogActive: false, hasShadow: false };
      try {
        const ctx = await withTimeout(page.evaluate(failureContextProbe, undefined), 1_500, "失败特征探测");
        if (ctx !== null && typeof ctx === "object") (err as any).locationFailure = { phase: "staleRef", candidates: 1, ...(ctx as any) };
      } catch {
        /* keep defaults */
      }
      throw err;
    }
  }

  // 0.2 SoM 标徽定位 (mark 参数):browser_screenshot { som: true } 返回的标徽
  // 编号直接点击 —— 多模态看图定位的落点;与 ref 同生命周期(导航即失效)。
  if (args.mark !== undefined && args.selector === undefined && args.ref === undefined) {
    const id = Number(args.mark);
    const entry = pageMark(page, id);
    if (entry === undefined) {
      throw new Error(
        `未知 mark: ${args.mark}(来自 browser_screenshot { som: true } 的标徽;导航后失效,请重新截图)`,
      );
    }
    const byPath = page.locator(entry.selector).first();
    if ((await withTimeout(byPath.count(), 3_000, "解析 mark 路径").catch(() => 0)) > 0) {
      return { locator: byPath, container: page, isIFrame: false, matchedCount: 1, visibleCount: 1 };
    }
    if (entry.name !== "") {
      const byRole = page.getByRole(entry.role as any, { name: buildFlexibleTextPattern(entry.name) }).first();
      if ((await withTimeout(byRole.count(), 1_500, "mark role 降级").catch(() => 0)) > 0) {
        return { locator: byRole, container: page, isIFrame: false, matchedCount: 1, visibleCount: 1 };
      }
    }
    {
      const err = new Error(`mark ${id} 已失效(元素不存在或内容已变化);请重新 browser_screenshot { som: true }`);
      (err as any).locationFailure = { phase: "staleRef", candidates: 1, dialogActive: false, hasShadow: false };
      throw err;
    }
  }

  // 0. 特性: 表格行级定向解析 (Row Scoping Pipeline)
  // 当传入 rowText/row (如 row: "TASK-1002", action: "编辑") 时，自动通过 Playwright filter 构造抗脆弱行内定位器
  const rowPattern = args.rowText ?? args.row;
  const actionPattern = args.actionText ?? args.action;
  if (rowPattern !== undefined) {
    const rowLoc = page.locator("tr, [role='row']").filter({ hasText: buildFlexibleTextPattern(String(rowPattern)) });
    let targetLoc: Locator;
    if (actionPattern !== undefined) {
      const actStr = String(actionPattern).trim();
      targetLoc = rowLoc
        .locator("button, a, [role='button'], [role='link']")
        .filter({ hasText: buildFlexibleTextPattern(actStr) })
        .first();
    } else {
      targetLoc = rowLoc.locator(args.selector || "button, a, [role='button'], [role='link']").first();
    }

    return {
      locator: targetLoc,
      container: page,
      isIFrame: false,
    };
  }

  // 0.5 意图语义定位 (what 参数):一句话描述目标,页内打分扫描 + ref 注册,
  // 替代 snapshot → find → click 三轮往返。仅当 selector/ref/mark/row 均缺省时启用。
  const what = args.what;
  if (typeof what === "string" && what.trim() !== "" && args.selector === undefined && args.ref === undefined && args.mark === undefined && rowPattern === undefined) {
    const res = await resolveSemanticTarget(page, what, {
      scope: typeof args.scope === "string" && args.scope !== "" ? args.scope : undefined,
    });
    if (!("candidates" in res)) return res;
    // 二次兜底:walker role 推断失灵的自定义组件,按常见 role + 弹性文本尝试
    for (const role of ["button", "link", "tab", "menuitem", "option"]) {
      const loc = page.getByRole(role as any, { name: buildFlexibleTextPattern(what) }).first();
      if ((await withTimeout(loc.count(), 800, "语义 role 兜底").catch(() => 0)) > 0) {
        return { locator: loc, container: page, isIFrame: false, matchedCount: 1, visibleCount: 1 };
      }
    }
    // bridge 兜底:接入 vite-plugin-dsh-bridge 的项目,页面存在 __DSH_BRIDGE__ 且
    // 暴露 resolveActionTarget 时,未命中自动用桥的语义地图反哺定位(桥的静态
    // 分析覆盖宿主扫描看不到的自定义组件)。纯 feature-detect,失败/shape 不符
    // 静默回落原错误,不放大;返回的 selector 仍走 Playwright 正常定位管线。
    {
      const bridgeHit = await withTimeout(
        page.evaluate(
          async (q: string) => {
            const b = (window as any).__DSH_BRIDGE__;
            if (b === undefined || typeof b.resolveActionTarget !== "function") return null;
            const targets = await b.resolveActionTarget({ query: q });
            if (!Array.isArray(targets) || targets.length === 0) return null;
            const t = targets[0] as { selector?: unknown } | null;
            if (t === null || typeof t !== "object" || typeof t.selector !== "string" || t.selector === "") return null;
            return { selector: t.selector };
          },
          what,
        ),
        2_500,
        "bridge 兜底",
      ).catch(() => null);
      // 节点侧 shape 防御(桥返回属不可信页面数据):仅接受 { selector: 非空字符串 }
      const bridgeSelector =
        bridgeHit !== null &&
        typeof bridgeHit === "object" &&
        typeof (bridgeHit as { selector?: unknown }).selector === "string" &&
        (bridgeHit as { selector: string }).selector !== ""
          ? (bridgeHit as { selector: string }).selector
          : null;
      if (bridgeSelector !== null) {
        const loc = page.locator(bridgeSelector).first();
        if ((await withTimeout(loc.count(), 1_500, "bridge 兜底定位").catch(() => 0)) > 0) {
          return { locator: loc, container: page, isIFrame: false, matchedCount: 1, visibleCount: 1, viaBridge: true };
        }
      }
    }
    // miss 数据挂在错误对象上,供 clickTool 走 SoM 截图兜底(多模态看图定位)
    const err = new Error(semanticMissMessage(res));
    (err as any).semanticMiss = res;
    (err as any).locationFailure = {
      phase: "zeroMatch",
      candidates: res.candidates.length,
      dialogActive: false,
      hasShadow: false,
    };
    // best-effort 补齐页面特征(失败路径多一次 evaluate 可接受,不放大错误)
    try {
      const ctx = await withTimeout(page.evaluate(failureContextProbe, undefined), 1_500, "失败特征探测");
      if (ctx !== null && typeof ctx === "object") {
        (err as any).locationFailure = { phase: "zeroMatch", candidates: res.candidates.length, ...(ctx as any) };
      }
    } catch {
      /* keep defaults */
    }
    throw err;
  }

  if (args.selector === undefined) {
    throw new Error("需要 selector 或 ref 之一 (或指定 row 与 action 进行表格行级定界,或用 what 语义定位)");
  }

  let rawSelector = String(args.selector);
  // 语法兼容: 自动将 jQuery 风格的 :visible 伪类转换为 Playwright 标准规范 (>> visible=true)
  if (/:visible\b/.test(rawSelector)) {
    rawSelector = rawSelector.replace(/:visible\b/g, " >> visible=true");
  }
  let baseLocator = page.locator(rawSelector);

  // 语法自愈: 对于 :has-text('...') 选择器，若直接查找无命中，自动采用全语言分词与空白容错匹配自愈
  const hasTextMatch = rawSelector.match(/^(.*?):has-text\(['"](.+?)['"]\)(.*)$/);
  if (hasTextMatch) {
    const directCount = await withTimeout(baseLocator.count(), 1_000, "探测 has-text").catch(() => 0);
    if (directCount === 0) {
      const [, prefix, text, suffix] = hasTextMatch;
      const flexPattern = buildFlexibleTextPattern(text);
      let flexLoc = page.locator(prefix.trim() || "*").filter({ hasText: flexPattern });
      if (suffix && suffix.trim()) {
        flexLoc = flexLoc.locator(suffix.trim());
      }
      if ((await withTimeout(flexLoc.count(), 1_000, "探测容错 has-text").catch(() => 0)) > 0) {
        baseLocator = flexLoc;
      }
    }
  }

  // 1. 若当前页面存在激活的 Modal / Dialog，优先检查弹窗内是否有匹配目标(防穿透)
  try {
    const activeDialog = getActiveDialog(page);
    if (activeDialog && typeof activeDialog.locator === "function") {
      const inDialog = activeDialog.locator(rawSelector);
      if (typeof inDialog.count === "function") {
        const inDialogCount = await withTimeout(inDialog.count(), 1_000, "弹窗内 selector 探测").catch(() => 0);
        if (inDialogCount > 0) {
          const inDialogVisible = typeof inDialog.locator === "function" ? inDialog.locator("visible=true") : null;
          const visibleCount =
            inDialogVisible && typeof inDialogVisible.count === "function"
              ? await withTimeout(inDialogVisible.count(), 1_000, "弹窗内可见探测").catch(() => 0)
              : 0;
          return {
            locator: visibleCount > 0 && typeof inDialogVisible?.first === "function" ? inDialogVisible.first() : inDialog.first(),
            container: page,
            isIFrame: false,
            matchedCount: inDialogCount,
            visibleCount,
          };
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 2. 统计总数并优先采用可见节点(Smart Visibility Arbitration)
  let totalCount: number | undefined;
  let visibleCount: number | undefined;
  let target = typeof baseLocator.first === "function" ? baseLocator.first() : baseLocator;

  if (typeof baseLocator.count === "function") {
    totalCount = await withTimeout(baseLocator.count(), 2_000, "selector 计数").catch(() => 0);
    if (totalCount > 0 && typeof baseLocator.locator === "function") {
      const visibleLocator = baseLocator.locator("visible=true");
      if (typeof visibleLocator.count === "function") {
        visibleCount = await withTimeout(visibleLocator.count(), 1_000, "selector 可见计数").catch(() => 0);
        if (visibleCount > 0 && typeof visibleLocator.first === "function") {
          target = visibleLocator.first();
        }
      }
    }
  }

  return {
    locator: target,
    container: page,
    isIFrame: false,
    ...(totalCount !== undefined ? { matchedCount: totalCount } : {}),
    ...(visibleCount !== undefined ? { visibleCount } : {}),
  };
}

/** 兼容旧版签名的目标定位快捷方式 */
export async function targetLocator(page: Page, args: Record<string, any>): Promise<Locator> {
  const res = await resolveTargetLocator(page, args);
  return res.locator;
}
