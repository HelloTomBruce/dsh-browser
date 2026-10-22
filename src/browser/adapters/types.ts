// dsh-browser · 可插拔组件库适配器类型规范 (Pluggable UI Adapter Types)
import type { Locator, Page } from "playwright-core";
import type { BrowserConfig } from "../types.js";

/** 动作执行上下文 */
export interface ActionContext {
  page: Page;
  config: BrowserConfig;
  target: Locator;
  action: "click" | "type" | "select" | "press";
  args: Record<string, any>;
  retries?: number;
}

/** 动作执行自愈结果 */
export interface ActionResult {
  handled: boolean;
  result?: any;
  retryWith?: {
    force?: boolean;
    timeoutMs?: number;
    target?: Locator;
  };
}

/**
 * 语义抽取钩子 (在页内注入执行，必须为自包含逻辑)
 * 用于扩展 walker.ts 的 nameOf、roleOf 与 isVisible
 */
export interface SemanticExtractionHook {
  /** 根据元素与角色提取语义名称，返回 null 表示未命中由默认逻辑处理 */
  resolveName?(el: Element, role: string): string | null;
  /** 识别特异性角色，返回 null 表示由默认逻辑处理 */
  resolveRole?(el: Element): string | null;
  /** 快速可见性启发式判定，返回 null 表示由默认逻辑处理 */
  checkVisible?(el: Element): boolean | null;
}

/**
 * 交互动作拦截器 (在 Node.js 主机侧执行)
 */
export interface ActionInterceptor {
  /** 交互发生前的预处理，如点击目标提升(Target Lifting) */
  beforeAction?(ctx: ActionContext): Promise<Locator | void>;
  /** 交互抛出错误时的自愈拦截器，如处理遮罩层拦截 */
  onActionError?(ctx: ActionContext, error: Error): Promise<ActionResult | void>;
}

/**
 * 页面稳态等待选项
 */
export interface QuiescenceOptions {
  /** 连续无 DOM 变更的静默时间(ms)，默认 80ms */
  quietMs?: number;
  /** 最大等待超时(ms)，默认 2500ms */
  maxTimeoutMs?: number;
  /** 检查的根节点选择器，默认 document.body */
  scope?: string;
}

/**
 * 下拉选择交互上下文
 */
export interface SelectContext {
  page: Page;
  target: Locator;
  label: string;
  want: string;
  exact: boolean;
  timeout: number;
}

/**
 * 下拉选择结果
 */
export interface SelectResult {
  selected: string;
}

/**
 * 统一组件库适配器接口 (Pluggable UI Adapter)
 */
export interface UIAdapter {
  /** 适配器唯一标识，如 "ant-design", "element-plus", "generic" */
  readonly name: string;

  /**
   * 页内环境探测：判断当前页面是否命中该 UI 框架特征
   * 在 page.evaluate 中运行
   */
  matches(page: Page): Promise<boolean>;

  /** 语义抽取扩展钩子 (页内序列化注入) */
  readonly extractionHook?: SemanticExtractionHook;

  /** 交互动作拦截器 (主机侧) */
  readonly actionInterceptor?: ActionInterceptor;

  /** 稳态等待策略 */
  waitForQuiescence?(page: Page, options?: QuiescenceOptions): Promise<boolean>;

  /** 活动弹窗/对话框的选择器列表 (用于限制作用域) */
  readonly activeDialogSelector?: string;

  /** 是否匹配该 UI 框架的下拉/浮层触发器 */
  matchesSelect?(ctx: SelectContext): Promise<boolean>;

  /** 执行下拉/浮层选择 */
  selectOption?(ctx: SelectContext): Promise<SelectResult>;
}
