// dsh-browser · Element Plus / Element UI 专属适配器插件 (ElementPlusAdapter)
import type { Page } from "playwright-core";
import { withTimeout } from "../tools/common.js";
import { waitForDOMQuiescence } from "./quiescence.js";
import type {
  QuiescenceOptions,
  SelectContext,
  SelectResult,
  UIAdapter,
} from "./types.js";

export class ElementPlusAdapter implements UIAdapter {
  readonly name = "element-plus";

  /** 活动弹窗/抽屉选择器 */
  readonly activeDialogSelector =
    ".el-dialog:not([style*='display: none']), .el-drawer:not([style*='display: none'])";

  /** 探测当前页面是否使用了 Element Plus 体系 */
  async matches(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        return Boolean(document.querySelector("[class*='el-']"));
      });
    } catch {
      return false;
    }
  }

  /** 语义抽取钩子 */
  readonly extractionHook = {
    resolveName(el: Element, role: string): string | null {
      // 1. 包裹型单选/复选 (.el-radio, .el-checkbox)
      if (["checkbox", "radio", "switch"].includes(role)) {
        const wrap = el.closest(".el-radio, .el-checkbox, .el-switch, label");
        if (wrap) {
          const t = (wrap.textContent || "").trim().replace(/\s+/g, " ");
          if (t) return t.slice(0, 60);
        }
      }

      // 2. 表单项标签反查: .el-form-item-label
      const formItem = el.closest(".el-form-item");
      if (formItem) {
        const labelEl = formItem.querySelector(".el-form-item__label, label");
        if (labelEl && (typeof labelEl.contains !== "function" || !labelEl.contains(el))) {
          const txt = (labelEl.textContent || "").trim().replace(/\s+/g, " ");
          if (txt) return txt.slice(0, 60);
        }
      }

      return null;
    },

    resolveRole(el: Element): string | null {
      const cls = el.className;
      if (typeof cls === "string") {
        if (cls.includes("el-tabs__item")) return "tab";
        if (cls.includes("el-button")) return "button";
        if (cls.includes("el-select-dropdown__item")) return "option";
      }
      return null;
    },

    checkVisible(el: Element): boolean | null {
      if ("checkVisibility" in el) {
        const ok = (el as any).checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        });
        if (!ok) return false;
      }
      const cls = el.className;
      if (typeof cls === "string" && cls.includes("is-hidden")) {
        return false;
      }
      return null;
    },
  };

  /** 判断是否匹配 Element Plus 下拉触发器 */
  async matchesSelect(ctx: SelectContext): Promise<boolean> {
    return ctx.target
      .evaluate((el) => !!el.closest(".el-select, .el-select__wrapper"))
      .catch(() => false);
  }

  /** 执行 Element Plus 下拉选择 */
  async selectOption(ctx: SelectContext): Promise<SelectResult> {
    const { target, page, want, exact, timeout, label } = ctx;
    const probe = Math.min(timeout, 5_000);

    const isExpanded = await target
      .evaluate((el) => {
        const host = el.closest(".el-select");
        return host?.classList.contains("is-focus") || el.getAttribute("aria-expanded") === "true";
      })
      .catch(() => false);

    if (!isExpanded) {
      await target.click({ timeout: Math.min(timeout, 10_000) }).catch(async () => {
        await target.click({ timeout: 2_000, force: true });
      });
    }

    const options = page.locator(".el-select-dropdown:not([style*='display: none']) .el-select-dropdown__item");
    await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => {});

    const texts = (
      await withTimeout(options.allTextContents(), probe, "读取 Element 下拉选项").catch(
        () => [] as string[],
      )
    )
      .map((t) => t.trim())
      .filter(Boolean);

    if (texts.length === 0) {
      throw new Error(`点击 ${label} 后未出现 Element 下拉选项`);
    }

    const index = texts.findIndex((t) => (exact ? t === want : t.includes(want)));
    if (index === -1) {
      await target.click({ timeout: 1000 }).catch(() => {});
      throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
    }

    const chosen = options.nth(index);
    try {
      await chosen.click({ timeout: Math.min(probe, 2_000) });
    } catch {
      await chosen.click({ timeout: 1_500, force: true });
    }

    return { selected: texts[index] };
  }

  async waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean> {
    return waitForDOMQuiescence(page, { quietMs: 80, maxTimeoutMs: 2000, ...options });
  }
}
