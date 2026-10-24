// dsh-browser · DOM 原语与物理交互自愈 (DOM & Actionability Primitives)
import type { Locator, Page } from "playwright-core";
import { withTimeout } from "../tools/common.js";
import type { QuiescenceOptions } from "./types.js";

/**
 * 提取表单元素关联的语义 Label:
 * 覆盖原生 label、aria-labelledby、以及各类主流组件库的表单包装结构。
 * 供 targetLocator 及无障碍名称校验在浏览器端(evaluate)执行。
 */
export function extractElementLabel(el: Element): string {
  // 1. 原生 input.labels 支持
  if ("labels" in el && (el as HTMLInputElement).labels?.length) {
    const texts = Array.from((el as HTMLInputElement).labels || []).map((l) =>
      (l.innerText || l.textContent || "").trim(),
    );
    const joined = texts.filter(Boolean).join(" ");
    if (joined) return joined;
  }

  // 2. aria-labelledby 引用解析
  const labelledBy = typeof el.getAttribute === "function" ? el.getAttribute("aria-labelledby") : null;
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map((n) => (n.innerText || n.textContent || "").trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  // 3. 通用表单项容器解析 (支持各类 BEM / -item 规范的通用 wrapper)
  const formItem = el.closest(
    "[class*='form-item'], [class*='form__item'], [role='group'], form, .form-group",
  );
  if (formItem) {
    const labelEl = formItem.querySelector(
      "[class*='form-item-label'], [class*='form-item__label'], [class*='label'], label",
    );
    if (labelEl) {
      const txt = ((labelEl as HTMLElement).innerText || labelEl.textContent || "").trim();
      if (txt) return txt;
    }
  }

  return "";
}

/**
 * 统一判定元素或其上下文是否处于禁用状态 (Native disabled, WAI-ARIA aria-disabled, 以及通用 disabled class)
 */
export function isElementDisabled(el: Element): boolean {
  if (
    el.hasAttribute("disabled") ||
    (el as HTMLButtonElement).disabled === true ||
    el.getAttribute("aria-disabled") === "true"
  ) {
    return true;
  }
  const disabledPattern = "[disabled], [aria-disabled='true'], [class*='-disabled'], [class*='__disabled'], .is-disabled";
  return Boolean(el.matches?.(disabledPattern) || el.closest(disabledPattern));
}

/**
 * 等待页面 DOM 达到稳定状态 (基于 MutationObserver 静默期)
 */
export async function waitForDOMQuiescence(
  page: Page,
  options: QuiescenceOptions = {},
): Promise<boolean> {
  const quietMs = Math.min(Math.max(options.quietMs ?? 80, 20), 1000);
  const maxTimeoutMs = Math.min(Math.max(options.maxTimeoutMs ?? 2500, 200), 15000);
  const scope = options.scope ?? "";

  try {
    const isQuiet = await page.evaluate(
      `(({ quietMs, maxTimeoutMs, scope }) => {
        return new Promise((resolve) => {
          const root = scope ? document.querySelector(scope) : document.body;
          if (!root) return resolve(true);

          let timer = null;
          let settled = false;

          const finish = (result) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (maxTimer) clearTimeout(maxTimer);
            observer.disconnect();
            resolve(result);
          };

          const resetTimer = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => finish(true), quietMs);
          };

          const observer = new MutationObserver(() => {
            resetTimer();
          });

          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          resetTimer();
          const maxTimer = setTimeout(() => finish(false), maxTimeoutMs);
        });
      })`,
      { quietMs, maxTimeoutMs, scope },
    );
    return Boolean(isQuiet);
  } catch {
    return false;
  }
}

/**
 * 目标提升原语 (Target Lifting):
 * 现代 Web 页面中自定义 checkbox / radio 的原生 <input> 通常设置了 opacity: 0 或宽高为 0，
 * 并由外层 label 或 wrapper 承载视觉与交互。当目标为隐藏 input 时，自动提升定位至可见的外层宿主容器。
 */
export async function liftTargetIfHiddenInput(
  target: Locator,
  evalTimeout = 2000,
): Promise<Locator> {
  try {
    const targetFirst = typeof target.first === "function" ? target.first() : target;
    const isHiddenInput = await withTimeout(
      targetFirst.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        if (tag !== "input") return false;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type !== "checkbox" && type !== "radio") return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isHidden = rect.width === 0 || rect.height === 0 || style.opacity === "0" || style.visibility === "hidden";
        if (!isHidden) return false;
        const wrapper = el.closest("label, [class*='wrapper'], [class*='radio'], [class*='checkbox'], li");
        return Boolean(wrapper);
      }),
      evalTimeout,
      "检查隐藏单选/多选",
    ).catch(() => false);

    if (isHiddenInput) {
      const lifted = targetFirst.locator("xpath=ancestor::*[self::label or contains(@class, 'wrapper') or contains(@class, 'checkbox') or contains(@class, 'radio')][1]");
      if ((await withTimeout(lifted.count(), 1000, "检查提升目标").catch(() => 0)) > 0) {
        return lifted.first();
      }
    }
  } catch {
    // 降级原 target
  }
  return target;
}

/**
 * 遮罩与过渡拦截自愈:
 * 处理弹窗打开/关闭动画期间遮罩层 (mask) 暂时拦截指针事件的偶发异常
 */
export function isMaskInterceptionError(error: Error): boolean {
  const msg = error.message;
  return (
    msg.includes("intercepts pointer events") ||
    msg.includes("not stable") ||
    msg.includes("is not visible")
  );
}
