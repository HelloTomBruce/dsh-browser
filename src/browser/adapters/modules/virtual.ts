// dsh-browser · 虚拟长列表与表格抽取模块 (Virtual Scroller & Extractor)
import type { Page } from "playwright-core";
import type { VirtualExtractOptions } from "../types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function extractVirtualListHelper(
  page: Page,
  options: VirtualExtractOptions,
): Promise<Record<string, any>[]> {
  const { scope, fields, maxRows = 1000, stepPixels = 350 } = options;
  const containerSelector =
    scope || ".ant-table-body, .el-table__body-wrapper, [class*='virtual-list'], [style*='overflow-y: auto'], [style*='overflow: auto']";

  const results: Record<string, any>[] = [];
  const seenHashes = new Set<string>();

  let sameHeightCount = 0;
  let lastScrollTop = -1;

  while (results.length < maxRows && sameHeightCount < 3) {
    // 1. 抽取当前可视视口内的行数据
    const currentRows: Record<string, any>[] = await page.evaluate(
      ({ containerSel, fieldMap }) => {
        const container = document.querySelector(containerSel) || document.body;
        // 启发式寻找行节点
        const rows = container.querySelectorAll(
          ".ant-table-row, .el-table__row, [role='row'], [class*='list-item'], [class*='virtual-item']",
        );
        const data: Record<string, any>[] = [];

        for (const row of Array.from(rows)) {
          const item: Record<string, any> = {};
          let hasVal = false;
          for (const [key, sel] of Object.entries(fieldMap)) {
            const targetEl = row.querySelector(sel as string);
            const val = targetEl ? (targetEl.textContent || "").trim() : "";
            if (val) hasVal = true;
            item[key] = val;
          }
          if (hasVal) {
            data.push(item);
          }
        }
        return data;
      },
      { containerSel: containerSelector, fieldMap: fields },
    );

    // 2. 去重沉淀
    let addedCount = 0;
    for (const row of currentRows) {
      const hash = JSON.stringify(row);
      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        results.push(row);
        addedCount++;
        if (results.length >= maxRows) break;
      }
    }
    if (results.length >= maxRows) break;

    // 3. 驱动滚动条向下步进
    const scrollState = await page.evaluate(
      ({ containerSel, step }) => {
        const container = document.querySelector(containerSel) as HTMLElement | null;
        if (!container) return { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
        container.scrollTop += step;
        return {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        };
      },
      { containerSel: containerSelector, step: stepPixels },
    );

    const reachedBottom =
      scrollState.scrollHeight > 0 &&
      scrollState.scrollTop + scrollState.clientHeight >= scrollState.scrollHeight;

    if (reachedBottom && addedCount === 0) {
      break;
    }

    if (scrollState.scrollTop === lastScrollTop) {
      sameHeightCount++;
    } else {
      sameHeightCount = 0;
    }
    lastScrollTop = scrollState.scrollTop;

    // 等待虚拟 DOM 渲染更新
    await sleep(60);
  }

  return results;
}
