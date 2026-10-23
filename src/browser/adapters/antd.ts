// dsh-browser · Ant Design (Vue / React) 专属适配器插件 (AntDesignAdapter)
import type { Locator, Page } from "playwright-core";
import { waitForDOMQuiescence } from "./quiescence.js";
import type {
  ActionContext,
  ActionResult,
  FormFieldItem,
  QuiescenceOptions,
  SelectContext,
  SelectResult,
  UIAdapter,
  VirtualExtractOptions,
} from "./types.js";
import { fillDateRangeHelper } from "./modules/temporal.js";
import { selectPathHelper } from "./modules/hierarchy.js";
import { transferItemsHelper } from "./modules/transfer.js";
import { extractVirtualListHelper } from "./modules/virtual.js";
import { fillEditorHelper } from "./modules/editor.js";
import { dragAndDropHelper } from "./modules/drag.js";

export class AntDesignAdapter implements UIAdapter {
  readonly name = "ant-design";

  /** 活动弹窗/抽屉选择器 */
  readonly activeDialogSelector = ".ant-modal:not([style*='display: none']), .ant-drawer:not([style*='display: none'])";

  /** 探测当前页面是否使用了 Ant Design 体系 */
  async matches(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        return Boolean(document.querySelector("[class*='ant-'], #__ANTD_PRO__"));
      });
    } catch {
      return false;
    }
  }

  /** 语义抽取钩子 (注意：函数将在页内自包含执行，不得引用外部闭包) */
  readonly extractionHook = {
    resolveName(el: Element, role: string): string | null {
      // 1. 包裹型单选/复选/开关控件 (.ant-radio-wrapper, .ant-checkbox-wrapper, .ant-switch)
      if (["checkbox", "radio", "switch"].includes(role)) {
        const wrap = el.closest(
          "label, .ant-radio-wrapper, .ant-checkbox-wrapper, .ant-transfer-list-content-item, [class*='wrapper']",
        );
        if (wrap) {
          const t = (wrap.textContent || "").trim().replace(/\s+/g, " ");
          if (t) return t.slice(0, 60);
        }
      }

      // 2. 表单项标签反查: 控件位于 .ant-form-item 内部时，反向提取对应的 .ant-form-item-label
      const formItem = el.closest(".ant-form-item");
      if (formItem) {
        const labelEl = formItem.querySelector(".ant-form-item-label, label");
        if (labelEl && (typeof labelEl.contains !== "function" || !labelEl.contains(el))) {
          const txt = (labelEl.textContent || "").trim().replace(/\s+/g, " ");
          if (txt) return txt.slice(0, 60);
        }
      }

      // 3. 弹窗/抽屉浮层标题反查
      if (role === "dialog") {
        const titleEl = el.querySelector(".ant-modal-title, .ant-drawer-title");
        if (titleEl) {
          const txt = (titleEl.textContent || "").trim().replace(/\s+/g, " ");
          if (txt) return txt.slice(0, 60);
        }
      }

      return null;
    },

    resolveRole(el: Element): string | null {
      const cls = el.className;
      if (typeof cls === "string") {
        if (cls.includes("ant-tabs-tab-btn") || cls.includes("ant-tabs-tab")) return "tab";
        if (cls.includes("ant-btn")) return "button";
        if (cls.includes("ant-select-item-option")) return "option";
        if (cls.includes("ant-table-row")) return "row";
      }
      return null;
    },

    checkVisible(el: Element): boolean | null {
      // 优先利用原生 checkVisibility 避免重排回流
      if ("checkVisibility" in el) {
        const ok = (el as any).checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
        if (!ok) return false;
      }
      // 检查 Ant Design 特异性隐藏类名
      const cls = el.className;
      if (typeof cls === "string") {
        if (
          cls.includes("-hidden") ||
          cls.includes("ant-modal-wrap-hidden") ||
          cls.includes("ant-select-dropdown-hidden")
        ) {
          return false;
        }
      }
      return null;
    },
  };

  /** 交互动作拦截器 (主机侧执行) */
  readonly actionInterceptor = {
    async beforeAction(ctx: ActionContext): Promise<Locator | void> {
      if (ctx.action !== "click") return;

      // 目标提升(Target Lifting)：
      // 1. 若点击的是被零尺寸隐藏的原生 input，提升至其外部可交互 wrapper
      // 2. 若点击的是 Ant Design combobox 内部的 0 尺寸/opacity 0 input，提升至 .ant-select-selector
      try {
        const targetKind = await ctx.target.evaluate((el) => {
          if (el.tagName.toLowerCase() !== "input") return null;
          const type = (el.getAttribute("type") || "").toLowerCase();
          const role = el.getAttribute("role");
          const cls = el.className || "";
          if (type === "checkbox" || type === "radio") {
            const rect = el.getBoundingClientRect();
            const wrapper = el.closest(".ant-checkbox-wrapper, .ant-radio-wrapper");
            if (wrapper && (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).opacity === "0")) {
              return "checkbox-radio";
            }
          }
          if (role === "combobox" || cls.includes("ant-select-selection-search-input") || Boolean(el.closest(".ant-select"))) {
            return "combobox-input";
          }
          return null;
        });

        if (targetKind === "checkbox-radio") {
          return ctx.target.locator("xpath=ancestor::*[contains(@class, '-wrapper')][1]");
        }
        if (targetKind === "combobox-input") {
          const selectorLocator = ctx.target.locator(
            "xpath=ancestor-or-self::*[contains(@class, 'ant-select-selector') or contains(@class, 'ant-select')][1]",
          );
          if ((await selectorLocator.count().catch(() => 0)) > 0) {
            return selectorLocator;
          }
        }
      } catch {
        // 评估失败忽略，按原 target 执行
      }
    },

    async onActionError(ctx: ActionContext, error: Error): Promise<ActionResult | void> {
      const msg = error.message;

      // 自愈策略 1: 遮罩层拦截 (intercepts pointer events) 或动画导致的非稳态超时
      if (
        msg.includes("intercepts pointer events") ||
        msg.includes("is not visible") ||
        msg.includes("not stable") ||
        msg.includes("Timeout")
      ) {
        const isMask =
          msg.includes("ant-modal-wrap") ||
          msg.includes("ant-modal-mask") ||
          msg.includes("ant-drawer-mask");

        if (isMask) {
          // 方案 A：如果是遮罩正在淡出动画，快速等待 100ms
          await ctx.page.waitForTimeout(100);
          // 方案 B：重试使用 force: true 穿透拦截
          return {
            handled: true,
            retryWith: { force: true, timeoutMs: 3000 },
          };
        }

        // 针对 Ant Design 下拉触发器或按钮动画过程中的点击挂起，尝试 force 快速恢复
        const isAntElement = await ctx.target
          .evaluate((el) => Boolean(el.closest("[class*='ant-']")))
          .catch(() => false);
        if (isAntElement) {
          return {
            handled: true,
            retryWith: { force: true, timeoutMs: 3000 },
          };
        }
      }

      return { handled: false };
    },
  };

  /** 页面稳态等待 */
  async waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean> {
    return waitForDOMQuiescence(page, { quietMs: 80, maxTimeoutMs: 2000, ...options });
  }

  /** 判断是否匹配 Ant Design 下拉触发器 */
  async matchesSelect(ctx: SelectContext): Promise<boolean> {
    return ctx.target
      .evaluate((el) => {
        if (el.closest(".ant-select, .ant-select-selector")) return true;
        const id = el.id || "";
        const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
        return /^rc_select_/.test(id) || /^rc_select_/.test(controls);
      })
      .catch(() => false);
  }

  /** 执行 Ant Design 下拉选择 */
  async selectOption(ctx: SelectContext): Promise<SelectResult> {
    const { target, page, want, exact, timeout, label } = ctx;
    const probe = Math.min(timeout, 5_000);

    // 检查是否已经处于展开状态(避免重复点击误收起)
    const isExpanded = await target
      .evaluate((el) => {
        if (el.getAttribute("aria-expanded") === "true") return true;
        const host = el.closest(".ant-select");
        if (host && host.classList.contains("ant-select-open")) return true;
        if (host?.getAttribute("aria-expanded") === "true") return true;
        const inner = host?.querySelector('input[role="combobox"], [aria-expanded]');
        if (inner?.getAttribute("aria-expanded") === "true") return true;
        const controlsId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
        if (controlsId) {
          const dd = document.getElementById(controlsId);
          if (dd && dd.offsetParent !== null) return true;
        }
        return false;
      })
      .catch(() => false);

    if (!isExpanded) {
      const clickTarget = target.locator(".ant-select-selector").first();
      if ((await clickTarget.count().catch(() => 0)) > 0) {
        await clickTarget.click({ timeout: 2000 }).catch(async () => {
          await target.click({ timeout: 2000, force: true });
        });
      } else {
        await target.click({ timeout: 2000 }).catch(async () => {
          await target.click({ timeout: 2000, force: true });
        });
      }
      await page.waitForTimeout(120);
    }

    // 定位选项:深度解析关联的 controlsId (支持 el 本身、内部 input、或最近 .ant-select 宿主内部的 combobox/controls)
    const controlsId = await target
      .evaluate((el) => {
        const direct = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
        if (direct) return direct;
        const host = el.closest(".ant-select") || el.querySelector(".ant-select") || el;
        const inner = host?.querySelector(
          "input[role='combobox'], input[aria-controls], [aria-controls], [aria-owns]",
        );
        return (
          inner?.getAttribute("aria-controls") ||
          inner?.getAttribute("aria-owns") ||
          host?.getAttribute("aria-controls") ||
          ""
        );
      })
      .catch(() => "");

    let options: Locator;
    if (controlsId) {
      const parentDropdown = page.locator(
        `xpath=//*[@id='${controlsId}']/ancestor-or-self::*[contains(@class, 'ant-select-dropdown')][1] | //*[contains(@class, 'ant-select-dropdown')][.//*[@id='${controlsId}']]`,
      );
      const visual = parentDropdown.locator(".ant-select-item-option");
      if ((await visual.count().catch(() => 0)) > 0) {
        options = visual;
      } else {
        const roleOpt = parentDropdown.locator("[role='option']:not([style*='height: 0px'])");
        if ((await roleOpt.count().catch(() => 0)) > 0) {
          options = roleOpt;
        } else {
          options = parentDropdown.locator(".ant-select-item");
        }
      }
    } else {
      // 当 controlsId 未显式关联时：只定位当前激活的下拉浮层，多浮层时取最新插入的 DOM 节点（避免误中上一个遗留展开的浮层）
      const activeDropdowns = page.locator(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([style*='display: none'])",
      );
      const count = await activeDropdowns.count().catch(() => 0);
      const dropdown = count > 1 ? activeDropdowns.last() : activeDropdowns.first();
      const visual = dropdown.locator(".ant-select-item-option");
      if ((await visual.count().catch(() => 0)) > 0) {
        options = visual;
      } else {
        options = dropdown.locator("[role='option']:not([style*='height: 0px'])");
      }
    }

    await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => {});

    // 读取文本候选:覆盖 innerText, title, aria-label
    const entries = await options
      .evaluateAll((els) =>
        els.map((el) => {
          const h = el as HTMLElement;
          const text = (h.innerText || el.textContent || "").trim();
          const title = el.getAttribute("title") || "";
          const aria = el.getAttribute("aria-label") || "";
          return { text, title, aria };
        }),
      )
      .catch(() => [] as { text: string; title: string; aria: string }[]);

    const visibleTexts = entries.map((e) => e.text || e.title || e.aria).filter(Boolean);
    if (visibleTexts.length === 0) {
      throw new Error(`点击 ${label} 后未出现 Ant Design 下拉选项`);
    }

    // 空白归一化匹配 (解决 "导 出" vs "导出", "西 湖 区" vs "西湖区" 等分词空格干扰)
    const stripSpaces = (s: string) => s.replace(/\s+/g, "");
    const wantStripped = stripSpaces(want);

    const index = entries.findIndex((e) => {
      const candidates = [e.text, e.title, e.aria].filter(Boolean);
      if (exact) {
        return candidates.some((c) => c === want || stripSpaces(c) === wantStripped);
      }
      return candidates.some((c) => c.includes(want) || stripSpaces(c).includes(wantStripped));
    });

    if (index === -1) {
      // 匹配失败时主动收起当前浮层，避免干扰后续其他下拉的选择
      await page.keyboard.press("Escape").catch(() => {});
      throw new Error(`下拉选项中无 "${want}";可见选项: ${visibleTexts.join(" / ")}`);
    }

    // 三级降级点击(常规 -> force -> 原生 DOM click)
    const chosen = options.nth(index);
    try {
      await chosen.click({ timeout: Math.min(probe, 2_000) });
    } catch {
      try {
        await chosen.click({ timeout: 1_500, force: true });
      } catch {
        await chosen.evaluate((el) => {
          (el as HTMLElement).scrollIntoView?.({ block: "nearest" });
          (el as HTMLElement).click();
        });
      }
    }

    return { selected: visibleTexts[index] };
  }

  /** Ant Design 表单项精准识别与填充 */
  async fillFormField(
    page: Page,
    field: FormFieldItem,
    scope?: string,
  ): Promise<{ handled: boolean; error?: string }> {
    const root = scope ? page.locator(scope) : page;
    const { key, value } = field;

    try {
      // 1. 定位包含对应 Label 的 .ant-form-item
      const formItems = root.locator(".ant-form-item");
      const count = await formItems.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const item = formItems.nth(i);
        const labelEl = item.locator("label, .ant-form-item-label").first();
        let labelText = (await labelEl.innerText().catch(() => "")) || (await labelEl.textContent().catch(() => "")) || "";
        labelText = labelText.trim();

        if (labelText.includes(key)) {
          // 检查内部控件类型
          // A. 下拉选择器 .ant-select
          const antSelect = item.locator(".ant-select").first();
          if ((await antSelect.count().catch(() => 0)) > 0) {
            await this.selectOption({
              page,
              target: antSelect,
              label: key,
              want: String(value),
              exact: false,
              timeout: 5000,
            });
            return { handled: true };
          }

          // B. 日期与范围选择器 .ant-picker
          const antPicker = item.locator(".ant-picker").first();
          if ((await antPicker.count().catch(() => 0)) > 0) {
            const handled = await fillDateRangeHelper(page, antPicker, value as any);
            if (handled) return { handled: true };
          }

          // C. 级联选择器 .ant-cascader
          const antCascader = item.locator(".ant-cascader, .ant-cascader-picker").first();
          if ((await antCascader.count().catch(() => 0)) > 0 && Array.isArray(value)) {
            const handled = await selectPathHelper(page, antCascader, value);
            if (handled) return { handled: true };
          }

          // D. 开关控件 .ant-switch
          const antSwitch = item.locator(".ant-switch").first();
          if ((await antSwitch.count().catch(() => 0)) > 0) {
            const isChecked = await antSwitch
              .evaluate((el) => el.getAttribute("aria-checked") === "true")
              .catch(() => false);
            if (Boolean(value) !== isChecked) {
              await antSwitch.click();
            }
            return { handled: true };
          }

          // E. 普通输入框 / 文本域 / 数字输入框
          const input = item.locator("input, textarea").first();
          if ((await input.count().catch(() => 0)) > 0) {
            await input.fill(String(value));
            return { handled: true };
          }
        }
      }
    } catch (err: any) {
      return { handled: false, error: err.message };
    }

    return { handled: false };
  }

  async fillDate(ctx: ActionContext, field: string, dateValue: string | [string, string]): Promise<boolean> {
    return fillDateRangeHelper(ctx.page, field, dateValue);
  }

  async selectPath(ctx: ActionContext, field: string, path: string[]): Promise<boolean> {
    return selectPathHelper(ctx.page, field, path);
  }

  async transferItems(
    ctx: ActionContext,
    selector: string,
    direction: "left" | "right",
    items: string[],
  ): Promise<boolean> {
    return transferItemsHelper(ctx.page, selector, direction, items);
  }

  async extractVirtualList(page: Page, options: VirtualExtractOptions): Promise<Record<string, any>[]> {
    return extractVirtualListHelper(page, options);
  }

  async fillEditorContent(ctx: ActionContext, selector: string, content: string): Promise<boolean> {
    return fillEditorHelper(ctx.page, selector, content);
  }

  async dragAndDrop(ctx: ActionContext, sourceSelector: string, targetSelector: string): Promise<boolean> {
    return dragAndDropHelper(ctx.page, sourceSelector, targetSelector);
  }
}
