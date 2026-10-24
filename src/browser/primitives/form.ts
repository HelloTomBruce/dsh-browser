// dsh-browser · 通用表单填充原语 (Universal Form Filling Primitive)
import type { Page } from "playwright-core";
import { executeUniversalSelect } from "./select.js";
import type { FormFieldItem } from "./types.js";

export async function fillFormFieldHelper(
  page: Page,
  field: FormFieldItem,
  scope?: string,
): Promise<{ handled: boolean; error?: string }> {
  const root = scope ? page.locator(scope) : page;
  const { key, value } = field;

  try {
    // 1. 基于 Label 定位包含该文字的表单包装容器 (支持常见 -form-item / form-group 结构)
    const formItems = root.locator(
      "[class*='form-item'], [class*='form__item'], [role='group'], .form-group",
    );
    const count = await formItems.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const item = formItems.nth(i);
      const labelEl = item.locator("[class*='label'], label").first();
      let labelText =
        (await labelEl.innerText().catch(() => "")) ||
        (await labelEl.textContent().catch(() => "")) ||
        "";
      labelText = labelText.trim();

      if (labelText.includes(key)) {
        // 下拉选择
        const selectTrigger = item.locator("[role='combobox'], [class*='select']").first();
        if ((await selectTrigger.count().catch(() => 0)) > 0) {
          await executeUniversalSelect({
            page,
            target: selectTrigger,
            label: key,
            want: String(value),
            exact: false,
            timeout: 5000,
          });
          return { handled: true };
        }

        // 开关
        const switchEl = item.locator("[role='switch'], [class*='switch']").first();
        if ((await switchEl.count().catch(() => 0)) > 0) {
          const isChecked = await switchEl
            .evaluate((el) => el.getAttribute("aria-checked") === "true")
            .catch(() => false);
          if (Boolean(value) !== isChecked) {
            await switchEl.click();
          }
          return { handled: true };
        }

        // 普通输入框
        const input = item.locator("input, textarea").first();
        if ((await input.count().catch(() => 0)) > 0) {
          await input.fill(String(value));
          return { handled: true };
        }
      }
    }

    // 2. 尝试直接作为 CSS selector 定位
    try {
      const directLoc = root.locator(key).first();
      if ((await directLoc.count().catch(() => 0)) > 0) {
        const tag = await directLoc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        const type = await directLoc.getAttribute("type").catch(() => "");
        if (tag === "select") {
          await directLoc.selectOption({ label: String(value) });
          return { handled: true };
        }
        if (type === "checkbox") {
          const shouldCheck = Boolean(value);
          const isChecked = await directLoc.isChecked().catch(() => false);
          if (shouldCheck !== isChecked) await directLoc.click();
          return { handled: true };
        }
        await directLoc.fill(String(value));
        return { handled: true };
      }
    } catch {
      // 忽略
    }
  } catch (e) {
    return { handled: false, error: e instanceof Error ? e.message : String(e) };
  }

  return { handled: false, error: `未能通过表单 Label 或选择器定位到字段: ${key}` };
}
