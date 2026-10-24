// dsh-browser · 时序组件原语 (DateRangePicker & Temporal Primitive)
import type { Locator, Page } from "playwright-core";

export async function fillDateRangeHelper(
  page: Page,
  container: string | Locator,
  dateValue: string | [string, string],
): Promise<boolean> {
  const containerLocator = typeof container === "string" ? page.locator(container).first() : container.first();

  // 1. 快捷预设标签处理 (如 "最近7天", "最近30天", "本月")
  if (typeof dateValue === "string") {
    const isShortcut = /最近|本月|上月|本周|上周|今天|昨日/.test(dateValue);
    if (isShortcut) {
      // 点击容器激活浮层
      await containerLocator.click().catch(() => {});
      const shortcutBtn = page.locator(
        `[class*='preset'] li:has-text("${dateValue}"), [class*='shortcut']:has-text("${dateValue}"), button:has-text("${dateValue}")`,
      ).first();
      if (await shortcutBtn.isVisible().catch(() => false)) {
        await shortcutBtn.click();
        return true;
      }
    }
  }

  // 2. 双输入框区间设值
  if (Array.isArray(dateValue) && dateValue.length === 2) {
    const [start, end] = dateValue;
    const inputs = containerLocator.locator("input");
    const count = await inputs.count().catch(() => 0);

    if (count >= 2) {
      const startInput = inputs.nth(0);
      const endInput = inputs.nth(1);

      await startInput.click().catch(() => {});
      await startInput.fill(start).catch(() => {});
      await startInput.press("Enter").catch(() => {});

      await endInput.click().catch(() => {});
      await endInput.fill(end).catch(() => {});
      await endInput.press("Enter").catch(() => {});
      return true;
    }
  }

  // 3. 单日期回退设值
  if (typeof dateValue === "string") {
    const input = containerLocator.locator("input").first();
    if ((await input.count().catch(() => 0)) > 0) {
      await input.click().catch(() => {});
      await input.fill(dateValue).catch(() => {});
      await input.press("Enter").catch(() => {});
      return true;
    }
  }

  return false;
}
