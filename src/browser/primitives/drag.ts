// dsh-browser · 拖拽交互原语 (Drag & Drop Primitive)
import type { Locator, Page } from "playwright-core";

export type DragChannel = "dragTo" | "mouse";

/**
 * 核心:在两个已解析的 Locator 之间执行拖拽。
 * 优先 Playwright dragTo(覆盖 HTML5 DnD 与多数组件库);
 * 失败或调用方指定 preferMouse(如跨 Frame,dragTo 的已知限制)时
 * 降级为物理鼠标序列。返回实际使用的通道。失败抛错(带可定位的诊断信息)。
 */
export async function dragAndDropLocators(
  page: Page,
  source: Locator,
  target: Locator,
  opts: { timeoutMs?: number; preferMouse?: boolean } = {},
): Promise<DragChannel> {
  const timeoutMs = opts.timeoutMs ?? 3000;

  if (!opts.preferMouse) {
    try {
      if (typeof (source as any).dragTo === "function") {
        await (source as any).dragTo(target, { timeout: timeoutMs });
        return "dragTo";
      }
    } catch {
      // 降级为物理鼠标移动序列
    }
  }

  let srcErr: unknown = null;
  const srcBox = await source.boundingBox({ timeout: timeoutMs }).catch((e: unknown) => {
    srcErr = e;
    return null;
  });
  if (!srcBox) {
    throw new Error(
      `drag 失败: 源元素不可见或未命中(等待 ${timeoutMs}ms)${srcErr instanceof Error ? `: ${srcErr.message}` : ""}`,
    );
  }
  let tgtErr: unknown = null;
  const tgtBox = await target.boundingBox({ timeout: timeoutMs }).catch((e: unknown) => {
    tgtErr = e;
    return null;
  });
  if (!tgtBox) {
    throw new Error(
      `drag 失败: 目标元素不可见或未命中(等待 ${timeoutMs}ms)${tgtErr instanceof Error ? `: ${tgtErr.message}` : ""}`,
    );
  }

  // 物理鼠标坐标是视口相对的:任一端滚出视口(X 或 Y 轴)事件都会落空,先滚入视口再取坐标。
  const viewport = typeof page.viewportSize === "function" ? page.viewportSize() : null;
  const outsideViewport =
    viewport !== null &&
    (srcBox.x + srcBox.width < 0 ||
      srcBox.x > viewport.width ||
      tgtBox.x + tgtBox.width < 0 ||
      tgtBox.x > viewport.width ||
      srcBox.y + srcBox.height < 0 ||
      srcBox.y > viewport.height ||
      tgtBox.y + tgtBox.height < 0 ||
      tgtBox.y > viewport.height);
  if (outsideViewport && typeof target.scrollIntoViewIfNeeded === "function") {
    await target.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => {});
  }
  const sx = (outsideViewport ? await source.boundingBox({ timeout: timeoutMs }).catch(() => null) : null) ?? srcBox;
  const tx = (outsideViewport ? await target.boundingBox({ timeout: timeoutMs }).catch(() => null) : null) ?? tgtBox;

  await page.mouse.move(sx.x + sx.width / 2, sx.y + sx.height / 2);
  await page.mouse.down();
  await page.mouse.move(tx.x + tx.width / 2, tx.y + tx.height / 2, { steps: 8 });
  await page.mouse.up();
  return "mouse";
}
