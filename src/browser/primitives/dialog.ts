// dsh-browser · 活动弹窗与隔离容器原语 (Dialog & Overlay Primitives)
// 选择器知识来自 primitives/ui-library.ts 注册表(库精确层 + 通用子串层),
// 本文件只做编排与仲裁;标准层(WAI-ARIA)在此声明。
import type { Locator, Page } from "playwright-core";
import { withTimeout } from "../tools/common.js";
import { pickTopDialog } from "../walker.js";
import { LIBRARY_DIALOG_CONTAINERS, composeDialogFuzzy } from "./ui-library.js";

/** 标准层:WAI-ARIA 语义,任何库与原生实现通用。 */
const ARIA_DIALOG_SELECTORS = [
  "[role='dialog']",
  "[role='alertdialog']",
  "[aria-modal='true']",
  "dialog[open]",
];

/** display:none 内联样式预过滤(动画关闭中的弹窗/keep-alive 残留)。 */
const hiddenGuard = (sel: string) => `${sel}:not([style*='display: none'])`;

/** 精确层 = 标准层 + 库精确层(ui-library 注册表单一来源,新增 UI 库 = 追加 spec)。 */
export const DIALOG_PRECISE_SELECTORS = [...ARIA_DIALOG_SELECTORS, ...LIBRARY_DIALOG_CONTAINERS]
  .map(hiddenGuard)
  .join(", ");

/** 通用模糊层(未注册库兜底):子串词 + :not() 排除子节点。 */
export const DIALOG_FUZZY_SELECTORS = composeDialogFuzzy();

/**
 * 历史并集 = 精确层 + 模糊层。semantic.ts 弹窗上下文检测与 getActiveDialog 的
 * domOrder 兜底消费(行为与抽取前的并集等价)。
 */
export const ACTIVE_DIALOG_SELECTORS = [DIALOG_PRECISE_SELECTORS, DIALOG_FUZZY_SELECTORS].join(", ");

/** 活动弹窗解析结果:locator + 实际仲裁通道(诊断线索)。 */
export interface ActiveDialog {
  locator: Locator;
  via: "zIndex" | "domOrder";
  z?: number;
  tier?: "precise" | "fuzzy";
}

/**
 * 获取当前页面上处于活动状态的最顶层弹窗容器;无弹窗返回 null。
 * ① 快速通道——并集零命中(绝大多数无弹窗的工具调用)直接返回 null,与旧行为
 * 「空 locator + 下游 count 0」等价,零额外 evaluate 往返;
 * ② 有弹窗时走分层选择器 + 页内 z-index/可见性仲裁(walker pickTopDialog,
 * 页内逻辑单一来源),单次 round-trip;
 * ③ evaluate 失败(极端 CSP/销毁竞态)或复核计数为 0 时回退文档序 last()
 * 旧行为并标 via: "domOrder",不阻断主流程。
 */
export async function getActiveDialog(page: Page): Promise<ActiveDialog | null> {
  // 快速通道:并集零命中 → 无任何疑似弹窗,直接返回(热路径不加 evaluate)
  try {
    const unionLoc = page.locator(ACTIVE_DIALOG_SELECTORS);
    if (typeof unionLoc.count === "function") {
      const n = await withTimeout(unionLoc.count(), 800, "弹窗快速探测").catch(() => 0);
      if (n === 0) return null;
    }
  } catch {
    /* 快速通道失败不阻断,继续仲裁 */
  }
  try {
    const pick = await withTimeout(
      page.evaluate(pickTopDialog, { precise: DIALOG_PRECISE_SELECTORS, fuzzy: DIALOG_FUZZY_SELECTORS }),
      1_500,
      "活动弹窗仲裁",
    );
    if (
      pick !== null &&
      typeof pick === "object" &&
      typeof (pick as { selector?: unknown }).selector === "string" &&
      (pick as { selector: string }).selector !== ""
    ) {
      const hit = pick as { selector: string; z: number; tier: "precise" | "fuzzy" };
      const loc = page.locator(hit.selector);
      if (typeof loc.count === "function") {
        const n = await withTimeout(loc.count(), 800, "活动弹窗复核").catch(() => 0);
        if (n > 0) {
          return {
            locator: typeof loc.first === "function" ? loc.first() : loc,
            via: "zIndex",
            z: hit.z,
            tier: hit.tier,
          };
        }
      }
    }
  } catch {
    /* 回退 domOrder 兜底 */
  }
  const dialogLoc = page.locator(ACTIVE_DIALOG_SELECTORS);
  return { locator: typeof dialogLoc.last === "function" ? dialogLoc.last() : dialogLoc.first(), via: "domOrder" };
}

export function getActiveDialogSelectors(): string {
  return ACTIVE_DIALOG_SELECTORS;
}
