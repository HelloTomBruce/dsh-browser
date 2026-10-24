// dsh-browser · 拖拽交互原语 (Drag & Drop Primitive)
import type { Page } from "playwright-core";

export async function dragAndDropHelper(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
): Promise<boolean> {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();

  if (typeof source.count === "function" && typeof target.count === "function") {
    if ((await source.count().catch(() => 0)) === 0 || (await target.count().catch(() => 0)) === 0) {
      return false;
    }
  }

  try {
    if (typeof (source as any).dragTo === "function") {
      await (source as any).dragTo(target, { timeout: 3000 });
      return true;
    }
  } catch {
    // 降级为物理鼠标移动序列
  }

  try {
    const srcBox = await source.boundingBox();
    const tgtBox = await target.boundingBox();
    if (!srcBox || !tgtBox) return false;

    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2, { steps: 5 });
    await page.mouse.up();
    return true;
  } catch {
    return false;
  }
}
