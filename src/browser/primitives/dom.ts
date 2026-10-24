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

// ---------------------------------------------------------------------------
// 点击效果验证(M6):短窗口 MutationObserver 收集变化元素摘要,回答
// 「这一下点出了什么动静」——DOM 变化/URL 变化/新请求,三者全空 = 大概率
// 点了个寂寞(覆盖层拦截/事件被吞),agent 换候选重试而不是干等。
// ---------------------------------------------------------------------------

import { injectWalker } from "../walker.js";

/** 页内变化收集核心逻辑(begin 装表;walker cssPath 单一来源;dedup + 截断)。 */
const beginWatchInjector = injectWalker<unknown, boolean>((_payload, w) => {
  const w2 = window as unknown as Record<string, unknown>;
  const prev = w2.__dshWatch as { observer?: MutationObserver } | undefined;
  if (prev?.observer) {
    try {
      prev.observer.disconnect();
    } catch {
      /* ignore */
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const note = (node: Node | null, kind: string) => {
    if (node === null || out.length >= 30) return;
    // 文本/注释节点(childList 的 added/removed 或 characterData 的 target)
    // 归属到其父元素 —— textContent 赋值是「替换文本节点」,不是 characterData
    let el: Node = node;
    if (el.nodeType === 3 || el.nodeType === 8) {
      el = (el as CharacterData).parentElement ?? el;
    }
    if (el.nodeType !== 1) return;
    const sel = w.cssPath(el as Element);
    const key = `${kind}:${sel}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`${kind} ${sel}`);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => note(n as Node | null, "+"));
      r.removedNodes.forEach((n) => note(n as Node | null, "-"));
      if (r.type === "attributes") note(r.target as Node, "~");
      if (r.type === "characterData") {
        const t = r.target as ChildNode | null;
        note(t && t.parentElement ? t.parentElement : null, "~");
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  w2.__dshWatch = { observer, out };
  return true;
});

/** 收口:graceMs 宽限(等异步涟漪)后断开观察器并返回变化摘要。 */
const endWatchInjector = injectWalker<
  { graceMs: number },
  Promise<{ mutations: string[]; domChanged: boolean }>
>((payload) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const w2 = window as unknown as Record<string, unknown>;
      const watch = w2.__dshWatch as { observer?: MutationObserver; out?: string[] } | undefined;
      w2.__dshWatch = undefined;
      let mutations: string[] = [];
      if (watch?.observer) {
        try {
          watch.observer.disconnect();
        } catch {
          /* ignore */
        }
        mutations = (watch.out ?? []).slice(0, 30);
      }
      resolve({ mutations, domChanged: mutations.length > 0 });
    }, payload.graceMs);
  });
});

/**
 * 开始记录 DOM 变化(点击前调用):在页内装 MutationObserver,变化累积到
 * window.__dshWatch。失败静默(endChangeWatch 会返回空摘要,不放大错误)。
 */
export async function beginChangeWatch(page: Page): Promise<void> {
  try {
    await withTimeout(page.evaluate(beginWatchInjector, undefined), 1_500, "变化记录启动");
  } catch {
    /* 页面导航中:效果验证降级为空摘要 */
  }
}

/**
 * 收口变化记录(点击后调用):graceMs 宽限(默认 600ms,等异步涟漪)后断开
 * 观察器,返回去重截断(≤30)的变化元素选择器列表。未曾 begin 时返回空摘要。
 */
export async function endChangeWatch(
  page: Page,
  options: { graceMs?: number } = {},
): Promise<{ mutations: string[]; domChanged: boolean }> {
  const graceMs = Math.min(Math.max(options.graceMs ?? 600, 100), 3000);
  try {
    const out = await withTimeout(
      page.evaluate(endWatchInjector, { graceMs }),
      graceMs + 2_000,
      "变化摘要收口",
    );
    return out ?? { mutations: [], domChanged: false };
  } catch {
    return { mutations: [], domChanged: false };
  }
}
