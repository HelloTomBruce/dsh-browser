// dsh-browser · 通用 W3C 标准适配器 (GenericAdapter)
// 当未匹配到任何特异性 UI 组件库时作为基底兜底
import type { Page } from "playwright-core";
import { withTimeout } from "../tools/common.js";
import { waitForDOMQuiescence } from "./quiescence.js";
import type {
  FormFieldItem,
  QuiescenceOptions,
  SelectContext,
  SelectResult,
  UIAdapter,
} from "./types.js";

export class GenericAdapter implements UIAdapter {
  readonly name = "generic";

  /** 通用 W3C 标准弹窗选择器 */
  readonly activeDialogSelector =
    "[role='dialog']:not([style*='display: none']), dialog[open]";

  async matches(_page: Page): Promise<boolean> {
    return true; // 始终匹配作为兜底
  }

  readonly extractionHook = {
    resolveName(el: Element, _role: string): string | null {
      // 通用包裹 label 提取
      const wrapLabel = el.closest("label");
      if (wrapLabel) {
        const t = (wrapLabel.textContent || "").trim().replace(/\s+/g, " ");
        if (t) return t.slice(0, 60);
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
      return null;
    },
  };

  /** 兜底匹配所有下拉交互 */
  async matchesSelect(_ctx: SelectContext): Promise<boolean> {
    return true;
  }

  /** 执行下拉选择：支持原生 <select> 与通用 ARIA combobox/listbox */
  async selectOption(ctx: SelectContext): Promise<SelectResult> {
    const { target, page, want, exact, timeout, label } = ctx;
    const probe = Math.min(timeout, 5_000);

    // 1. 判断是否为原生 HTML <select> 标签
    const tag = await withTimeout(
      target.evaluate((el) => el.tagName.toLowerCase()),
      2_000,
      "检查原生 select 标签",
    ).catch(() => "");

    if (tag === "select") {
      try {
        await target.selectOption({ label: want }, { timeout });
        return { selected: want };
      } catch {
        const options = await withTimeout(
          target.locator("option").allTextContents(),
          probe,
          "读取原生下拉选项",
        ).catch(() => [] as string[]);
        throw new Error(
          `原生下拉无选项 "${want}";可用选项: ${options.map((t) => t.trim()).join(" / ")}`,
        );
      }
    }

    // 2. 通用 ARIA combobox / listbox 交互
    const isExpanded = await target
      .evaluate(
        (el) =>
          el.getAttribute("aria-expanded") === "true" ||
          el.closest('[role="combobox"]')?.getAttribute("aria-expanded") === "true",
      )
      .catch(() => false);

    if (!isExpanded) {
      await target.click({ timeout: Math.min(timeout, 10_000) }).catch(async () => {
        await target.click({ timeout: 2_000, force: true });
      });
    }

    const options = page.locator(
      "[role='listbox']:not([hidden]):not([style*='display: none']):not([style*='height: 0px']) [role='option']:not([style*='height: 0px'])",
    );
    await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => {});

    const texts = (
      await withTimeout(options.allTextContents(), probe, "读取通用下拉选项").catch(
        () => [] as string[],
      )
    )
      .map((t) => t.trim())
      .filter(Boolean);

    if (texts.length === 0) {
      throw new Error(`点击 ${label} 后未出现下拉选项(非原生 select,也不是已知的组件库下拉)`);
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
      try {
        await chosen.click({ timeout: 1_500, force: true });
      } catch {
        await chosen.evaluate((el) => (el as HTMLElement).click());
      }
    }

    return { selected: texts[index] };
  }

  async waitForQuiescence(page: Page, options?: QuiescenceOptions): Promise<boolean> {
    return waitForDOMQuiescence(page, options);
  }

  async fillFormField(
    page: Page,
    field: FormFieldItem,
    scope?: string,
  ): Promise<{ handled: boolean; error?: string }> {
    const root = scope ? page.locator(scope) : page;
    const { key, value } = field;

    // 1. 尝试直接作为 CSS selector
    try {
      const loc = root.locator(key).first();
      if ((await loc.count()) > 0) {
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        const type = await loc.getAttribute("type").catch(() => "");
        if (tag === "select") {
          await loc.selectOption({ label: String(value) });
          return { handled: true };
        }
        if (type === "checkbox") {
          const checked = await loc.isChecked();
          if (Boolean(value) !== checked) await loc.click();
          return { handled: true };
        }
        await loc.fill(String(value));
        return { handled: true };
      }
    } catch {
      // 不是合法 selector，继续走 label 检索
    }

    // 2. 尝试根据 label / placeholder / getByLabel 定位
    try {
      const byLabel = root.getByLabel(key, { exact: false }).first();
      if ((await byLabel.count()) > 0) {
        const tag = await byLabel.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "select") {
          await byLabel.selectOption({ label: String(value) });
        } else {
          await byLabel.fill(String(value));
        }
        return { handled: true };
      }

      const byPlaceholder = root.getByPlaceholder(key, { exact: false }).first();
      if ((await byPlaceholder.count()) > 0) {
        await byPlaceholder.fill(String(value));
        return { handled: true };
      }
    } catch (e: any) {
      return { handled: false, error: e.message };
    }

    return { handled: false };
  }
}
