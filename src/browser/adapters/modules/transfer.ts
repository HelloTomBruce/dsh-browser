// dsh-browser · 穿梭框交互组件模块 (Transfer Suite)
import type { Page } from "playwright-core";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function transferItemsHelper(
  page: Page,
  containerSelector: string,
  direction: "left" | "right",
  items: string[],
): Promise<boolean> {
  const container = page.locator(containerSelector).first();
  if (!(await container.count())) return false;

  // 1. 确定源侧列表容器
  // AntD: .ant-transfer-list (左 index 0, 右 index 1)
  // Element: .el-transfer-panel (左 index 0, 右 index 1)
  const sourceIndex = direction === "right" ? 0 : 1;
  const lists = container.locator(".ant-transfer-list, .el-transfer-panel, .transfer-list");
  if ((await lists.count()) < 2) return false;

  const sourcePanel = lists.nth(sourceIndex);

  // 2. 勾选源列表中的目标项
  for (const item of items) {
    const itemCheckbox = sourcePanel
      .locator(
        `.ant-transfer-list-content-item:has-text("${item}") input[type="checkbox"], .el-transfer-panel__item:has-text("${item}") input[type="checkbox"], label:has-text("${item}")`,
      )
      .first();

    if (await itemCheckbox.count()) {
      await itemCheckbox.click().catch(() => {});
      await sleep(40);
    }
  }

  // 3. 点击穿梭转移按钮
  // AntD / Element 穿梭按钮通常在操作栏
  const btnSelector =
    direction === "right"
      ? ".ant-transfer-operation button:first-child, .el-transfer__buttons button:last-child, button[title*='右'], button:has-text('>')"
      : ".ant-transfer-operation button:last-child, .el-transfer__buttons button:first-child, button[title*='左'], button:has-text('<')";

  const opBtn = container.locator(btnSelector).first();
  if (await opBtn.count()) {
    await opBtn.click().catch(() => {});
    await sleep(80);
    return true;
  }

  return false;
}
