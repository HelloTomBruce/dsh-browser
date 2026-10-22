// dsh-browser · DOM 与 UI 组件库结构适配器 (DOM & Modal Adapters)
// 将表单 Label 解析(Ant Design, Element, 原生 Label)与活动弹窗作用域感知(Modal Scope)
// 彻底封装在适配器中，避免污染核心交互与元素定位逻辑。
import { adapterRegistry } from "./registry.js";
/**
 * 提取表单元素关联的语义 Label:
 * 覆盖原生 label、aria-labelledby、以及各类主流组件库(Ant Design, Element Plus, Bootstrap 等)的表单包装结构。
 * 供 targetLocator 及无障碍名称校验在浏览器端(evaluate)执行。
 */
export function extractElementLabel(el) {
    // 1. 原生 input.labels 支持
    if ("labels" in el && el.labels?.length) {
        const texts = Array.from(el.labels || []).map((l) => (l.innerText || l.textContent || "").trim());
        const joined = texts.filter(Boolean).join(" ");
        if (joined)
            return joined;
    }
    // 2. aria-labelledby 引用解析
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter((n) => !!n)
            .map((n) => (n.innerText || n.textContent || "").trim())
            .filter(Boolean)
            .join(" ");
        if (text)
            return text;
    }
    // 3. UI 组件库表单项容器解析(Ant Design, Element Plus 等通用 wrapper)
    const formItem = el.closest(".ant-form-item, .el-form-item, [role='group'], form, .form-group");
    if (formItem) {
        const labelEl = formItem.querySelector(".ant-form-item-label, .el-form-item__label, label");
        if (labelEl) {
            const txt = (labelEl.innerText || labelEl.textContent || "").trim();
            if (txt)
                return txt;
        }
    }
    return "";
}
/** 主流前端组件库激活弹窗/对话框的选择器列表 (从注册表动态聚合，兜底默认值) */
export const ACTIVE_DIALOG_SELECTORS = [
    "[role='dialog']:not([style*='display: none'])",
    ".ant-modal:not([style*='display: none'])",
    ".el-dialog:not([style*='display: none'])",
    "dialog[open]",
].join(", ");
/**
 * 获取当前页面上处于活动状态的弹窗容器(Locator)。
 * 优先从 adapterRegistry 动态聚合选择器，兼顾测试 Mock 对象。
 */
export function getActiveDialog(page) {
    const dynamicSelectors = adapterRegistry.getActiveDialogSelectors();
    const selector = dynamicSelectors || ACTIVE_DIALOG_SELECTORS;
    const dialogLoc = page.locator(selector);
    return typeof dialogLoc.last === "function" ? dialogLoc.last() : dialogLoc.first();
}
//# sourceMappingURL=dom.js.map