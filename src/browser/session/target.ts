// dsh-browser · 统一目标定位解析门面 (Target Resolution Pipeline)
import type { Frame, Locator, Page } from "playwright-core";
import { extractElementLabel, getActiveDialog } from "../primitives/index.js";
import { pageRef } from "./cache.js";
import { withTimeout } from "../tools/common.js";
import { resolveSemanticTarget, semanticMissMessage } from "./semantic.js";
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
 * 统一解析目标元素：
 * 自动识别 selector 或 ref；若 ref 标记位于子 Frame，自动绑定到对应子 Frame 上下文。
 * 具备路径防漂移校验与 getByRole 自愈降级能力。
 */
export async function resolveTargetLocator(
  page: Page,
  args: Record<string, any>,
): Promise<TargetResolution> {
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

    throw new Error(
      `ref ${ref} 已失效(元素不存在或内容已变化);请重新 browser_snapshot { mode: "aria" }`,
    );
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
  // 替代 snapshot → find → click 三轮往返。仅当 selector/ref/row 均缺省时启用。
  const what = args.what;
  if (typeof what === "string" && what.trim() !== "" && args.selector === undefined && args.ref === undefined && rowPattern === undefined) {
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
    throw new Error(semanticMissMessage(res));
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
