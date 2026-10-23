// dsh-browser · 层级与树选择组件模块 (Cascader & TreeSelect)
import type { Locator, Page } from "playwright-core";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function selectPathHelper(
  page: Page,
  trigger: string | Locator,
  path: string[],
): Promise<boolean> {
  if (!path || path.length === 0) return false;

  // 1. 点击触发器展开级联面板
  const triggerLocator = typeof trigger === "string" ? page.locator(trigger).first() : trigger.first();
  await triggerLocator.click().catch(() => {});
  await sleep(150);

  // 2. 逐层查找并点击对应路径项
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const itemLocator = page
      .locator(
        `.ant-cascader-menu-item:has-text("${segment}"), .el-cascader-node:has-text("${segment}"), [role="menuitem"]:has-text("${segment}"), .ant-tree-treenode:has-text("${segment}"), .ant-cascader-node:has-text("${segment}"), [class*="cascader"]:has-text("${segment}")`,
      )
      .last();

    try {
      await itemLocator.waitFor({ state: "visible", timeout: 2500 });
      await itemLocator.click();
      await sleep(100);
    } catch {
      return false;
    }
  }

  return true;
}
