// dsh-browser · 客户端 — 设置导航图标补丁(防御式)
//
// 背景:DSH 设置外壳(dsh-client-ui-settings-general)的 navIcon(id) 只认
// account/models/agent-presets/plugins/archived-sessions 五个内置 id,其余分区
// 一律回退齿轮图标,slot API 不提供自定义导航图标。本模块参照 dsh-cool-theme 的
// 做法做运行时 DOM 补丁:按 label 文本定位自己的导航行,藏掉外壳注入的齿轮 svg,
// 原位插入自绘浏览器窗口图标。
//
// 契约:失败即静默回退。外壳改类名/改结构时,最差表现只是显示回齿轮,
// 绝不允许影响设置面板渲染或插件 apply 本身。

import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

/** 设置分区的 label 候选(当前值 + 历史值,兼容新旧构建并存期)。 */
const NAV_LABELS = ["浏览器", "🌐 浏览器"];

/** 插入节点的标识属性,防重复补丁。 */
const PATCH_ATTR = "data-dsh-browser-nav-icon";
/** 被藏掉的外壳 svg 的标识属性,供卸载时恢复。 */
const HIDDEN_ATTR = "data-dsh-browser-nav-hidden";

/** 16px 浏览器窗口轮廓图标,currentColor 跟随外壳导航文字色/主题。 */
const BROWSER_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<rect x="1.5" y="2.75" width="13" height="10.5" rx="1.75" stroke="currentColor" stroke-width="1.1"/>' +
  '<path d="M1.5 5.75h13" stroke="currentColor" stroke-width="1.1"/>' +
  '<circle cx="3.4" cy="4.25" r="0.65" fill="currentColor"/>' +
  '<circle cx="5.2" cy="4.25" r="0.65" fill="currentColor"/>' +
  "</svg>";

/**
 * 扫描设置外壳的导航行,命中本分区的行则藏齿轮、插自绘图标。
 * 幂等:已补丁过的行(带 PATCH_ATTR 节点)直接跳过。
 */
function patchNavIcon(): void {
  if (typeof document === "undefined") return;
  // 外壳导航行是 CSS module 类名,只能用类名片段匹配;两级回退防外壳微调。
  const cells = document.querySelectorAll('button[class*="navCell"]');
  const rows = cells.length > 0 ? Array.from(cells) : Array.from(document.querySelectorAll('[class*="navList"] button'));
  for (const cell of rows) {
    const labelEl = cell.querySelector('[class*="navLabel"]');
    const text = (labelEl?.textContent ?? cell.textContent ?? "").trim();
    if (!NAV_LABELS.some((label) => text === label)) continue;
    if (cell.querySelector(`[${PATCH_ATTR}]`)) continue;
    const svg = cell.querySelector("svg");
    if (!svg || !svg.parentNode) continue;
    svg.style.display = "none";
    svg.setAttribute(HIDDEN_ATTR, "1");
    const holder = document.createElement("span");
    holder.setAttribute(PATCH_ATTR, "1");
    holder.setAttribute("aria-hidden", "true");
    holder.style.display = "inline-flex";
    holder.style.flex = "none";
    holder.innerHTML = BROWSER_ICON_SVG;
    svg.parentNode.insertBefore(holder, svg.nextSibling);
  }
}

/** 补丁外壳是 shell 私有 DOM:任何一步异常都吞掉,回退为外壳默认齿轮。 */
function safePatchNavIcon(): void {
  try {
    patchNavIcon();
  } catch {
    // 静默回退:见模块头注释契约
  }
}

/** 卸载清理:恢复被藏的 svg、移除插入节点。 */
function unpatchNavIcon(): void {
  if (typeof document === "undefined") return;
  for (const el of Array.from(document.querySelectorAll(`[${PATCH_ATTR}]`))) {
    el.remove();
  }
  for (const svg of Array.from(document.querySelectorAll(`svg[${HIDDEN_ATTR}]`))) {
    (svg as HTMLElement).style.display = "";
    svg.removeAttribute(HIDDEN_ATTR);
  }
}

/**
 * 安装设置导航图标补丁:立即补一次,再以 MutationObserver 持续复补丁
 * (外壳重渲染导航时会还原齿轮)。通过 ctx.effect 注册卸载清理。
 */
export function installSettingsNavIconPatch(ctx: ClientContext): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  safePatchNavIcon();
  let observer: MutationObserver | null = null;
  try {
    observer = new MutationObserver(safePatchNavIcon);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch {
    observer = null; // 观察者挂了不致命:初次补丁已生效,最差回退齿轮
  }
  ctx.effect(() => () => {
    if (observer) {
      const obs = observer;
      observer = null;
      try {
        obs.disconnect();
      } catch {
        // 静默
      }
    }
    try {
      unpatchNavIcon();
    } catch {
      // 静默
    }
  });
}
