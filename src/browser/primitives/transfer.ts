// dsh-browser · 穿梭框交互原语 (Dual Listbox / Transfer Primitive)
import type { Page } from "playwright-core";

export async function transferItemsHelper(
  page: Page,
  selector: string,
  arg3: string | string[],
  arg4?: string | string[],
): Promise<boolean> {
  const container = page.locator(selector).first();
  if (typeof container.count === "function" && (await container.count().catch(() => 0)) === 0) {
    return false;
  }

  const directionStr = typeof arg3 === "string" ? arg3 : (typeof arg4 === "string" ? arg4 : "right");
  const items = Array.isArray(arg3) ? arg3 : (Array.isArray(arg4) ? arg4 : []);
  const direction = directionStr.includes("left") && !directionStr.includes("right-to-left") ? "left" : "right";

  const lists = container.locator("[class*='transfer-list'], [class*='transfer-panel'], .transfer-list");
  const sourceIndex = direction === "right" ? 0 : 1;
  const sourceList = lists.nth(sourceIndex);

  // 1. 勾选源列表中指定的选项
  for (const item of items) {
    const itemCheckbox = sourceList
      .locator(
        `[class*='item']:has-text("${item}") input[type="checkbox"], label:has-text("${item}")`,
      )
      .first();

    const count = typeof itemCheckbox.count === "function" ? await itemCheckbox.count().catch(() => 0) : 1;
    if (count > 0) {
      if (typeof (itemCheckbox as any).isChecked === "function") {
        const isChecked = await (itemCheckbox as any).isChecked().catch(() => false);
        if (!isChecked) {
          await itemCheckbox.click({ force: true }).catch(() => {});
        }
      } else {
        await itemCheckbox.click({ force: true }).catch(() => {});
      }
    }
  }

  // 2. 点击穿梭按钮
  const btnSelector =
    direction === "right"
      ? "[class*='operation'] button:first-child, [class*='buttons'] button:last-child, button[title*='右'], button:has-text('>')"
      : "[class*='operation'] button:last-child, [class*='buttons'] button:first-child, button[title*='左'], button:has-text('<')";

  const moveBtn = container.locator(btnSelector).first();
  const moveBtnCount = typeof moveBtn.count === "function" ? await moveBtn.count().catch(() => 0) : 1;
  if (moveBtnCount > 0) {
    await moveBtn.click().catch(() => {});
    return true;
  }

  return false;
}
