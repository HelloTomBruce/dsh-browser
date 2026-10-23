// dsh-browser · 物理轨迹跨容器拖拽模块 (Drag & Drop)
import type { Page } from "playwright-core";
import { generateBezierPath } from "../../stealth/mouse.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function dragAndDropHelper(
  page: Page,
  sourceSelector: string,
  targetSelector: string,
): Promise<boolean> {
  const source = page.locator(sourceSelector).first();
  const target = page.locator(targetSelector).first();

  const srcBox = await source.boundingBox();
  const tgtBox = await target.boundingBox();

  if (!srcBox || !tgtBox) return false;

  const startPt = {
    x: srcBox.x + srcBox.width / 2,
    y: srcBox.y + srcBox.height / 2,
  };
  const endPt = {
    x: tgtBox.x + tgtBox.width / 2,
    y: tgtBox.y + tgtBox.height / 2,
  };

  // 1. 移动至源元素中心并按下鼠标
  await page.mouse.move(startPt.x, startPt.y);
  await page.mouse.down();
  await sleep(60);

  // 2. 沿三次贝塞尔平滑轨迹拖动至目标
  const path = generateBezierPath(startPt, endPt, 25);
  for (const pt of path) {
    await page.mouse.move(pt.x, pt.y);
    await sleep(6);
  }

  // 3. 悬停并松开鼠标
  await sleep(60);
  await page.mouse.up();
  await sleep(40);

  return true;
}
