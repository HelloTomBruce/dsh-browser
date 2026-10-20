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
    function roleOf(el) {
        const explicit = el.getAttribute("role");
        if (explicit)
            return explicit.trim().split(/\s+/)[0] ?? "";
        const tag = el.tagName.toLowerCase();
        switch (tag) {
            case "a": return el.hasAttribute("href") ? "link" : "";
            case "button": return "button";
            case "input": {
                const t = (el.getAttribute("type") ?? "text").toLowerCase();
                if (t === "checkbox")
                    return "checkbox";
                if (t === "radio")
                    return "radio";
                if (t === "range")
                    return "slider";
                if (t === "number")
                    return "spinbutton";
                if (t === "search")
                    return "searchbox";
                if (["button", "submit", "reset", "image"].includes(t))
                    return "button";
                if (["hidden", "file"].includes(t))
                    return "";
                return "textbox";
            }
            case "textarea": return "textbox";
            case "select": return "combobox";
            case "nav": return "navigation";
            case "main": return "main";
            case "header": return "banner";
            case "footer": return "contentinfo";
            case "form": return "form";
            case "h1":
            case "h2":
            case "h3":
            case "h4":
            case "h5":
            case "h6": return "heading";
            case "ul":
            case "ol": return "list";
            case "li": return "listitem";
            case "table": return "table";
            case "dialog": return "dialog";
            case "summary": return "button";
            default: return "";
        }
    }
    function nameOf(el, role) {
        const aria = el.getAttribute("aria-label");
        if (aria && aria.trim())
            return aria.trim().slice(0, 60);
        const labelledby = el.getAttribute("aria-labelledby");
        if (labelledby) {
            const t = labelledby
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
                .join(" ")
                .trim();
            if (t)
                return t.slice(0, 60);
        }
        if (el.id) {
            const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            const t = lab?.textContent?.trim();
            if (t)
                return t.slice(0, 60);
        }
        if (["textbox", "searchbox", "combobox", "spinbutton"].includes(role)) {
            const ph = el.getAttribute("placeholder");
            if (ph && ph.trim())
                return ph.trim().slice(0, 60);
        }
        const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
        if (text)
            return text.slice(0, 60);
        const title = el.getAttribute("title");
        if (title && title.trim())
            return title.trim().slice(0, 60);
        return "";
    }
    /** 稳定 CSS 路径:#id → [data-testid] → nth-of-type 链(≤6 层)。 */
    function cssPath(el) {
        if (el.id)
            return `#${CSS.escape(el.id)}`;
        const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id");
        if (testid)
            return `[data-testid="${testid.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
        const parts = [];
        let cur = el;
        while (cur && cur !== document.body && parts.length < 6) {
            const tag = cur.tagName.toLowerCase();
            const parent = cur.parentElement;
            if (!parent) {
                parts.unshift(tag);
                break;
            }
            const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            const idx = sameTag.indexOf(cur) + 1;
            parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            cur = parent;
        }
        return parts.join(" > ");
    }
    function isVisible(el) {
        if (el.getAttribute("aria-hidden") === "true")
            return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0)
            return false;
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
    }
    /**
     * 统一元素描述结构(F5 顺带统一):aria 快照 ref、find 匹配、
     * 拾取指纹(pick hint)、录制回声(recorder payload)共用同一份字段语义。
     */
    function describeElement(el) {
        const role = roleOf(el);
        const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "";
        return {
            role,
            name: nameOf(el, role),
            selector: cssPath(el),
            testid,
            id: el.id ?? "",
            tag: el.tagName.toLowerCase(),
            text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
            visible: isVisible(el),
        };
    }
    return { INTERACTIVE, STRUCTURAL, SKIP_TAGS, roleOf, nameOf, cssPath, isVisible, describeElement };
}
/** walker 核心的序列化源码(模块加载期取一次;tsdown/vitest 均原样保留)。 */
const CORE_SRC = __walkerCore.toString();
/**
 * 把消费方 entry(自包含函数,签名 (payload, w: WalkerApi) => R)拼装成
 * 可被 page.evaluate 序列化的独立函数 (payload: P) => R。
 * 拼装发生在模块加载期(new Function 一次性),调用期零开销。
 */
export function injectWalker(entry) {
    const src = `"use strict"; return function (payload) { const w = (${CORE_SRC})(); return (${entry.toString()})(payload, w); };`;
    return new Function(src)();
}
//# sourceMappingURL=walker.js.map