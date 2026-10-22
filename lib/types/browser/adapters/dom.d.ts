import type { Locator, Page } from "playwright-core";
/**
 * 提取表单元素关联的语义 Label:
 * 覆盖原生 label、aria-labelledby、以及各类主流组件库(Ant Design, Element Plus, Bootstrap 等)的表单包装结构。
 * 供 targetLocator 及无障碍名称校验在浏览器端(evaluate)执行。
 */
export declare function extractElementLabel(el: Element): string;
/** 主流前端组件库激活弹窗/对话框的选择器列表 */
export declare const ACTIVE_DIALOG_SELECTORS: string;
/**
 * 获取当前页面上处于活动状态的弹窗容器(Locator)。
 * 兼顾真实 Playwright Locator 与轻量测试 Mock 对象(兼容 .last() 与 .first())。
 */
export declare function getActiveDialog(page: Page): Locator;
//# sourceMappingURL=dom.d.ts.map