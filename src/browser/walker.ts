// dsh-browser · 页内 walker 单一来源(F5 副本收敛,方案 A 变体:自内联)
// ---------------------------------------------------------------------------
// 历史:roleOf/nameOf/cssPath/isVisible 曾以 4 份内联副本散布在
// buildAriaTree / findInteractive / captureSelectorHint(tools.ts)与
// installHumanRecorder(session.ts)。evaluate 序列化不允许闭包引用模块级
// 变量,当初各处内联是权宜。
//
// 现收敛为单一来源:本文件。`__walkerCore` 是一个**自包含**函数(禁止引用
// 任何模块级变量/导入,否则注入后运行时报错),页内注入通过 `injectWalker`
// 在模块加载期把它的源码(`Function.prototype.toString`)与消费方 entry 的
// 源码拼接成一个独立函数 —— 等价于构建期内联成字符串常量(方案 A 的目标
// 一样:运行时零开销、类型可检查、一处定义多处使用),且对 vitest(直接跑
// src)与 tsdown 产物(toString 源码原样保留)行为一致,无需在测试环境
// 重复构建期生成步骤。
//
// 注入后的函数形如:
//   function (payload) {
//     const w = (function __walkerCore() { ...原样源码... })();
//     return ((payload, w) => { ...消费方逻辑... })(payload, w);
//   }
// 可直接传给 page.evaluate / locator.evaluate / addInitScript。
// 消费方 entry 同样必须自包含(只允许引用自己的参数与局部变量)。
// ---------------------------------------------------------------------------

/** 页内 walker 核心(自包含;勿引用模块级变量、勿导入任何模块)。 */
function __walkerCore() {
  const INTERACTIVE = new Set([
    "link", "button", "textbox", "checkbox", "radio", "combobox", "listbox",
    "searchbox", "slider", "spinbutton", "switch", "tab", "menuitem", "option", "treeitem",
  ]);
  const STRUCTURAL = new Set([
    "navigation", "main", "banner", "contentinfo", "form", "search", "complementary",
    "region", "dialog", "alert", "table", "list", "heading", "toolbar", "menu", "menubar",
    "tablist", "tree", "grid",
  ]);
  const SKIP_TAGS = new Set(["script", "style", "template", "noscript", "svg", "path", "link", "meta", "br"]);

  function roleOf(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0] ?? "";

    // 现代 UI 组件库无显式 role 时的通用组件架构范式自愈 (支持各类遵循 BEM / kebab-case 规范的组件库)
    const cls = typeof el.className === "string" ? el.className : "";
    if (cls) {
      if (/(?:modal|dialog|message-box)[-_].*title\b/i.test(cls)) return "heading";
      if (/(?:select|cascader)[-_].*(?:option|node)\b/i.test(cls) || /(?:select)[-_].*item\b/i.test(cls)) return "option";
      if (/(?:dropdown|menu)[-_].*(?:item|option)\b/i.test(cls)) return "menuitem";
      if (/tree[-_].*(?:node|item)\b/i.test(cls)) return "treeitem";
      if (/tabs?[-_].*(?:tab|item)\b/i.test(cls) && !/pane/i.test(cls)) return "tab";
    }

    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a": {
        if (el.hasAttribute("href")) return "link";
        // 现代 Web / SPA (如 Ant Design / Element Plus) 中，无 href 但具备文本内容或子节点的 a 标签通常作为按钮或下拉触发器
        const text = (el.textContent || "").trim();
        if (text || el.children.length > 0) return "button";
        return "";
      }
      case "button": return "button";
      case "input": {
        const t = (el.getAttribute("type") ?? "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "range") return "slider";
        if (t === "number") return "spinbutton";
        if (t === "search") return "searchbox";
        if (["button", "submit", "reset", "image"].includes(t)) return "button";
        if (["hidden", "file"].includes(t)) return "";
        return "textbox";
      }
      case "textarea": return "textbox";
      case "select": return "combobox";
      case "nav": return "navigation";
      case "main": return "main";
      case "header": return "banner";
      case "footer": return "contentinfo";
      case "form": return "form";
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
      case "ul": case "ol": return "list";
      case "li": return "listitem";
      case "table": return "table";
      case "dialog": return "dialog";
      case "summary": return "button";
      default: return "";
    }
  }

  function nameOf(el: Element, role: string): string {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim().slice(0, 60);
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (t) return t.slice(0, 60);
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = lab?.textContent?.trim();
      if (t) return t.replace(/^[*：:\s]+|[*：:\s]+$/g, "").slice(0, 60);
    }
    const wrapLabel = el.closest("label");
    if (wrapLabel) {
      const t = wrapLabel.textContent?.trim();
      if (t) return t.replace(/^[*：:\s]+|[*：:\s]+$/g, "").slice(0, 60);
    }
    if (["checkbox", "radio", "switch"].includes(role)) {
      const container = el.closest("label, [class*='wrapper'], [class*='item'], li");
      if (container) {
        const t = container.textContent?.trim();
        if (t) return t.replace(/\s+/g, " ").replace(/^[*：:\s]+|[*：:\s]+$/g, "").slice(0, 60);
      }
    }
    if (["textbox", "searchbox", "combobox", "spinbutton", "slider", "listbox"].includes(role)) {
      const formItem = el.closest("[class*='form-item'], [class*='form__item'], [class*='form-group'], [role='group']");
      if (formItem) {
        const lab = formItem.querySelector("label, [class*='form-item-label'], [class*='form-item__label'], [class*='label']");
        if (lab) {
          const title = lab.getAttribute("title");
          const t = (title || lab.textContent || "").trim().replace(/^[*：:\s]+|[*：:\s]+$/g, "");
          if (t) return t.slice(0, 60);
        }
      }
      const selectHost = el.closest("[class*='select'], [class*='cascader'], [class*='picker']");
      if (selectHost) {
        const ph = selectHost.querySelector("[class*='placeholder'], [class*='selection-placeholder']")?.textContent?.trim();
        if (ph) return ph.slice(0, 60);
        const selVal = selectHost.querySelector("[class*='selection-item'], [class*='selected-value']")?.textContent?.trim();
        if (selVal) return selVal.slice(0, 60);
      }
      const ph = el.getAttribute("placeholder");
      if (ph && ph.trim()) return ph.trim().slice(0, 60);

      // 非标容器场景 1: 前置兄弟元素 (如 <span>地市:</span> <a-select ...> 或 <div class="addon">地市</div>)
      const host = selectHost || el;
      const prevEl = host.previousElementSibling;
      if (prevEl) {
        const prevText = (prevEl.textContent || "").trim().replace(/^[*：:\s]+|[*：:\s]+$/g, "");
        if (prevText && prevText.length <= 30) return prevText.slice(0, 60);
      }
      // 非标容器场景 2: 表格键值对 <td>地市</td> <td><select>...</td>
      const td = host.closest("td");
      if (td && td.previousElementSibling) {
        const tdText = (td.previousElementSibling.textContent || "").trim().replace(/^[*：:\s]+|[*：:\s]+$/g, "");
        if (tdText && tdText.length <= 30) return tdText.slice(0, 60);
      }
    }
    const text = ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (text) return text.slice(0, 60);
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim().slice(0, 60);
    return "";
  }

  /** 稳定 CSS 路径:#id → [data-testid] → nth-of-type 链(≤6 层)。
   * 跨 open shadow root:上溯经 composedParent(host 链),生成扁平 `>` 链 ——
   * Playwright 的 css 引擎对 open shadow root 是穿透的,扁平链可直接命中;
   * closed shadow root 页内不可见,不进遍历也不进路径。 */
  function cssPath(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
    if (testid) return `[data-testid="${testid.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 6) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = composedParent(cur);
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      const idx = sameTag.indexOf(cur) + 1;
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      cur = parent;
    }
    return parts.join(" > ");
  }

  /** 组合树父节点:普通 parentElement,shadow root 顶层则取宿主元素(跨边界上溯)。 */
  function composedParent(el: Element): Element | null {
    const p = el.parentElement;
    if (p !== null) return p;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) return root.host ?? null;
    return null;
  }

  /** 组合树子节点:light children + open shadowRoot 的顶层 children(穿透遍历用)。 */
  function deepChildren(el: Element): Element[] {
    const out = Array.from(el.children);
    const sr = el.shadowRoot;
    if (sr !== null && sr !== undefined) {
      for (const c of Array.from(sr.children)) out.push(c);
    }
    return out;
  }

  function isVisible(el: Element): boolean {
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return false;
    const cls = el.className;
    if (typeof cls === "string" && (cls.includes("-hidden") || cls.includes("is-hidden"))) return false;
    const rect = el.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0) || rect.left < -1000 || rect.top < -1000) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    // 现代 UI 框架 (AntD / Element 等) 中 checkbox / radio 的原生 input 通常设置了 opacity: 0 并由外层 wrapper 承载视觉
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    const isStyledInput = tag === "input" && (type === "checkbox" || type === "radio");
    if (!isStyledInput && style.opacity === "0") return false;
    return true;
  }

  /** 纯只读几何判定: 元素是否在当前视口可见区域内(含可选边距扩展)。 */
  function isElementInViewport(el: Element, padding = 0): boolean {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const winHeight = window.innerHeight || document.documentElement.clientHeight;
    const winWidth = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.bottom >= -padding &&
      rect.right >= -padding &&
      rect.top <= winHeight + padding &&
      rect.left <= winWidth + padding
    );
  }

  /**
   * 统一元素描述结构(F5 顺带统一):aria 快照 ref、find 匹配、
   * 拾取指纹(pick hint)、录制回声(recorder payload)共用同一份字段语义。
   */
  function describeElement(el: Element): {
    role: string;
    name: string;
    selector: string;
    testid: string;
    id: string;
    tag: string;
    text: string;
    visible: boolean;
  } {
    const role = roleOf(el);
    const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "";
    return {
      role,
      name: nameOf(el, role),
      selector: cssPath(el),
      testid,
      id: el.id ?? "",
      tag: el.tagName.toLowerCase(),
      text: ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      visible: isVisible(el),
    };
  }

  /** 疑似可点击 generic 元素(自定义组件的 span+click 等):无 ARIA 角色或显式
   * presentational(presentation/none)但具备 cursor:pointer / onclick 属性 /
   * tabindex≥0 特征且有非空文本(≤60 字符)。仅供扫描语义消费(what 语义扫描与
   * SoM 标徽共用,防判定分叉);aria 快照不纳入(避免噪音)——这是记录在案的
   * 设计分叉,见产品文档 03。 */
  function isProbablyClickable(el: Element): boolean {
    const role = roleOf(el);
    if (role !== "" && role !== "presentation" && role !== "none") return false;
    const text = ((el as HTMLElement).innerText || el.textContent || "").trim();
    if (text === "" || text.length > 60) return false;
    if (el.hasAttribute("onclick")) return true;
    const ti = (el as HTMLElement).tabIndex;
    if (typeof ti === "number" && ti >= 0) return true;
    try {
      return getComputedStyle(el).cursor === "pointer";
    } catch {
      return false;
    }
  }

  return { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible, isElementInViewport, describeElement, composedParent, deepChildren, isProbablyClickable };
}

/** walker 核心注入后暴露给 entry 的 API(类型层)。 */
export type WalkerApi = ReturnType<typeof __walkerCore>;

/** walker 核心的序列化源码(模块加载期取一次;tsdown/vitest 均原样保留)。 */
const CORE_SRC = __walkerCore.toString();

/** walker 核心序列化源(导出供 drift-guard 测试核对表单词表与注册表一致性)。 */
export const WALKER_CORE_SRC: string = CORE_SRC;

/**
 * 把消费方 entry(自包含函数,签名 (payload, w: WalkerApi) => R)拼装成
 * 可被 page.evaluate 序列化的独立函数 (payload: P) => R。
 * 拼装发生在模块加载期(new Function 一次性),调用期零开销。
 */
export function injectWalker<P, R>(entry: (payload: P, w: WalkerApi) => R): (payload: P) => R {
  const src = `"use strict"; return function (payload) { var __name = (t, v) => t; const w = (${CORE_SRC})(); return (${entry.toString()})(payload, w); };`;
  return new Function(src)() as (payload: P) => R;
}

// ---------------------------------------------------------------------------
// 活动弹窗顶层仲裁(未发版,页内单一来源):分层选择器 + 可见性过滤 + 有效 z-index。
// 消费方 primitives/dialog.ts getActiveDialog。返回唯一 selector(cssPath 语义,
// 零 DOM 变更)供节点侧构造 Locator。
// 排序键:(z-index, 同 z 内最外层候选优先, DOM 序后者胜) ——
//   * 同 z 且有包含关系 → 取最外层容器(否则 .ant-modal-footer 这类子节点会
//     因"文档序最后"系统性误选为"顶层弹窗");
//   * 兄弟弹窗同 z → DOM 序后者胜(与 antd 后挂载者在上层的表现一致);
//   * 不同 z → 高者胜(z-index 沿祖先链取有效值)。
// ---------------------------------------------------------------------------
export const pickTopDialog = injectWalker<
  { precise: string; fuzzy: string },
  { selector: string; z: number; tier: "precise" | "fuzzy" } | null
>((payload, w) => {
  const effectiveZ = (el: Element): number => {
    let node: Element | null = el;
    while (node !== null) {
      const cs = getComputedStyle(node);
      if (cs.position !== "static" && cs.zIndex !== "auto") {
        const z = Number.parseInt(cs.zIndex, 10);
        if (Number.isFinite(z)) return z;
      }
      node = w.composedParent(node);
    }
    return 0;
  };
  const visible = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const collect = (sel: string): Element[] => {
    try {
      return Array.from(document.querySelectorAll(sel)).filter(visible);
    } catch {
      return [];
    }
  };
  let tier: "precise" | "fuzzy" = "precise";
  let nodes = collect(payload.precise);
  if (nodes.length === 0) {
    tier = "fuzzy";
    nodes = collect(payload.fuzzy);
  }
  if (nodes.length === 0) return null;
  const zs = nodes.map((n) => effectiveZ(n));
  const maxZ = Math.max(...zs);
  const top = nodes.filter((n, i) => zs[i] === maxZ);
  // 同 z 内去掉被其他候选包含的节点(保留最外层容器);全互不含则原样
  const outermost = top.filter((n) => !top.some((m) => m !== n && m.contains(n)));
  const pool = outermost.length > 0 ? outermost : top;
  const winner = pool[pool.length - 1];
  if (winner === undefined) return null;
  return { selector: w.cssPath(winner), z: maxZ, tier };
});
