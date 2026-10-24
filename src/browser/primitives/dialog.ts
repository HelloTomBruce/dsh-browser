// dsh-browser · 活动弹窗与隔离容器原语 (Dialog & Overlay Primitives)
import type { Locator, Page } from "playwright-core";

/**
 * 通用活动弹窗/对话框/抽屉选择器列表
 * 基于 W3C WAI-ARIA 规范 (role="dialog", aria-modal="true") 与现代 Web 通用命名规范
 */
export const ACTIVE_DIALOG_SELECTORS = [
  "[role='dialog']:not([style*='display: none'])",
  "[role='alertdialog']:not([style*='display: none'])",
  "[aria-modal='true']:not([style*='display: none'])",
  "dialog[open]",
  ".ant-modal:not([style*='display: none'])",
  ".el-dialog:not([style*='display: none'])",
  ".ant-drawer:not([style*='display: none'])",
  ".el-drawer:not([style*='display: none'])",
  "[class*='modal']:not([style*='display: none'])",
  "[class*='drawer']:not([style*='display: none'])",
  "[class*='dialog']:not([style*='display: none'])",
].join(", ");

/**
 * 获取当前页面上处于活动状态的最顶层弹窗容器 (Locator)
 */
export function getActiveDialog(page: Page): Locator {
  const dialogLoc = page.locator(ACTIVE_DIALOG_SELECTORS);
  return typeof dialogLoc.last === "function" ? dialogLoc.last() : dialogLoc.first();
}

export function getActiveDialogSelectors(): string {
  return ACTIVE_DIALOG_SELECTORS;
}
