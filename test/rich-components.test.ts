import { describe, expect, it, vi } from "vitest";
import {
  dragAndDropLocators,
  fillEditorHelper,
  selectPathHelper,
  fillDateRangeHelper,
  transferItemsHelper,
  extractVirtualListHelper,
} from "../src/browser/primitives/index.js";

describe("全场景企业级富控件适配矩阵 (Enterprise Component Suite)", () => {
  it("A. 时序组件: DateRangePicker 双日历区间与快捷标签设置", async () => {
    const filledInputs: string[] = [];
    const mockPage: any = {
      locator: (sel: string) => ({
        first: () => ({
          click: async () => {},
          count: async () => 1,
          isVisible: async () => sel.includes("最近30天"),
          locator: (subSel: string) => ({
            count: async () => 2,
            nth: (i: number) => ({
              click: async () => {},
              fill: async (val: string) => {
                filledInputs.push(val);
              },
              press: async () => {},
            }),
            first: () => ({
              count: async () => 1,
              click: async () => {},
              fill: async (val: string) => {
                filledInputs.push(val);
              },
              press: async () => {},
            }),
          }),
        }),
      }),
    };

    // 1. 测试区间输入
    const rangeRes = await fillDateRangeHelper(mockPage, ".ant-picker-range", [
      "2026-10-01",
      "2026-10-31",
    ]);
    expect(rangeRes).toBe(true);
    expect(filledInputs).toEqual(["2026-10-01", "2026-10-31"]);

    // 2. 测试快捷标签
    const shortcutRes = await fillDateRangeHelper(mockPage, ".ant-picker-range", "最近30天");
    expect(shortcutRes).toBe(true);
  });

  it("B. 层级组件: Cascader 级联路径直达递归展开", async () => {
    const clickedItems: string[] = [];
    const mockPage: any = {
      locator: (sel: string) => ({
        first: () => ({
          click: async () => {},
        }),
        last: () => ({
          waitFor: async () => {},
          click: async () => {
            clickedItems.push(sel);
          },
        }),
      }),
    };

    const res = await selectPathHelper(mockPage, "#org-cascader", ["集团总部", "研发中心", "架构组"]);
    expect(res).toBe(true);
    expect(clickedItems.length).toBe(3);
    expect(clickedItems[0]).toContain("集团总部");
    expect(clickedItems[1]).toContain("研发中心");
    expect(clickedItems[2]).toContain("架构组");
  });

  it("C. 穿梭组件: Transfer 批量左右勾选穿梭", async () => {
    const checkedBoxes: string[] = [];
    let opClicked = false;

    const mockPage: any = {
      locator: (sel: string) => ({
        first: () => ({
          count: async () => 1,
          click: async () => {
            if (sel.includes("button")) opClicked = true;
          },
          locator: (subSel: string) => ({
            count: async () => 2,
            nth: (_i: number) => ({
              locator: (itemSel: string) => ({
                first: () => ({
                  count: async () => 1,
                  click: async () => checkedBoxes.push(itemSel),
                }),
              }),
            }),
            first: () => ({
              count: async () => 1,
              click: async () => {
                opClicked = true;
              },
            }),
          }),
        }),
      }),
    };

    const res = await transferItemsHelper(mockPage, "#user-transfer", "right", ["张三", "李四"]);
    expect(res).toBe(true);
    expect(checkedBoxes.length).toBe(2);
    expect(opClicked).toBe(true);
  });

  it("D. 虚拟滚动组件: Virtual Table / List 逐屏滚动去重抽取", async () => {
    let scrollStep = 0;
    const mockPage: any = {
      evaluate: async (fn: any, args: any) => {
        if (typeof args?.step === "number") {
          scrollStep += args.step;
          return {
            scrollTop: scrollStep,
            scrollHeight: 1000,
            clientHeight: 300,
          };
        }
        // 返回两批包含重复项的行
        if (scrollStep === 0) {
          return [
            { id: "1", name: "Alpha" },
            { id: "2", name: "Beta" },
          ];
        }
        return [
          { id: "2", name: "Beta" }, // 重复项
          { id: "3", name: "Gamma" },
        ];
      },
    };

    const rows = await extractVirtualListHelper(mockPage, {
      fields: { id: ".col-id", name: ".col-name" },
      maxRows: 10,
      stepPixels: 100,
    });

    // 应该成功去重，保留 3 行
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("E. 编辑器组件: Monaco / 富文本安全注入", async () => {
    let injected = false;
    const mockPage: any = {
      evaluate: async (fn: any, args: any) => {
        injected = true;
        return true;
      },
    };

    const res = await fillEditorHelper(mockPage, "#monaco-container", "console.log('hello')");
    expect(res).toBe(true);
    expect(injected).toBe(true);
  });

  it("F. 拖拽组件: 物理轨迹跨容器拖拽", async () => {
    const mouseEvents: string[] = [];
    const mockPage: any = {
      locator: (sel: string) => ({
        boundingBox: async () =>
          sel.includes("source")
            ? { x: 100, y: 100, width: 50, height: 50 }
            : { x: 300, y: 300, width: 50, height: 50 },
        first: () => mockPage.locator(sel),
      }),
      mouse: {
        move: async () => mouseEvents.push("move"),
        down: async () => mouseEvents.push("down"),
        up: async () => mouseEvents.push("up"),
      },
    };

    const res = await dragAndDropLocators(mockPage, mockPage.locator("#source"), mockPage.locator("#target"));
    expect(res).toBe("mouse");
    expect(mouseEvents).toContain("down");
    expect(mouseEvents).toContain("move");
    expect(mouseEvents).toContain("up");
  });
});
