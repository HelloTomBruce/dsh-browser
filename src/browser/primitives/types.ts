// dsh-browser · 通用交互原语类型规范 (Universal UI Primitives Types)
import type { Locator, Page } from "playwright-core";
import type { BrowserConfig } from "../types.js";

/** 下拉选择上下文 */
export interface SelectContext {
  page: Page;
  target: Locator;
  want: string;
  label?: string;
  exact?: boolean;
  clear?: boolean;
  timeout?: number;
}

/** 下拉选择执行结果 */
export interface SelectResult {
  selected: string;
}

/** 表单填充条目 */
export interface FormFieldItem {
  key: string;
  value: any;
}

/** 表单填充汇总结果 */
export interface FormFillResult {
  filled: string[];
  skipped: string[];
  errors: Record<string, string>;
  submitted?: boolean;
}

/** 页面稳态等待选项 */
export interface QuiescenceOptions {
  /** 连续无 DOM 变更的静默时间(ms)，默认 80ms */
  quietMs?: number;
  /** 最大等待超时(ms)，默认 2500ms */
  maxTimeoutMs?: number;
  /** 检查的根节点选择器，默认 document.body */
  scope?: string;
}

/** 虚拟长列表与表格抽取选项 */
export interface VirtualExtractOptions {
  /** 虚拟滚动的容器 CSS 选择器 */
  scope?: string;
  /** 待抽取的字段与对应列选择器字典，如 { id: ".col-id", name: ".col-name" } */
  fields: Record<string, string>;
  /** 最大抓取行数，默认 1000 */
  maxRows?: number;
  /** 每次滚动步进像素，默认 350 */
  stepPixels?: number;
}
