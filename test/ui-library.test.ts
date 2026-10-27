// UI 适配选择器注册表测试:库 spec 完整性、合成器纯函数、行为保持快照
// (与抽取前字符串逐字符等价)、扩展模拟(追加新库)、walker 页内副本 drift-guard。
import { describe, it, expect } from "vitest";
import {
  GENERIC,
  UI_LIBRARIES,
  dialogContainersOf,
  composeDialogFuzzy,
  dropdownFloatSelectors,
  dropdownOptionRowsOf,
  LIBRARY_DIALOG_CONTAINERS,
  WALKER_FORM_TOKENS,
  type UILibrarySpec,
} from "../src/browser/primitives/ui-library.js";
import { DROPDOWN_OPTION_SELECTOR } from "../src/browser/tools/common.js";
import { ACTIVE_DIALOG_SELECTORS, DIALOG_PRECISE_SELECTORS, DIALOG_FUZZY_SELECTORS } from "../src/browser/primitives/dialog.js";
import { WALKER_CORE_SRC } from "../src/browser/walker.js";

describe("库精确层 spec 完整性", () => {
  it("每个 spec 字段齐全且选择器形态合法", () => {
    expect(UI_LIBRARIES.length).toBeGreaterThanOrEqual(2);
    for (const lib of UI_LIBRARIES) {
      expect(lib.name).toBeTruthy();
      expect(lib.modalContainers.length).toBeGreaterThan(0);
      expect(lib.drawerContainers.length).toBeGreaterThan(0);
      expect(lib.dropdownContainers.length).toBeGreaterThan(0);
      expect(lib.dropdownOptions.length).toBeGreaterThan(0);
      for (const sel of [...lib.modalContainers, ...lib.drawerContainers, ...lib.dropdownContainers, ...lib.dropdownOptions]) {
        expect(sel).toMatch(/^[.#[]/); // 类名/ID/属性形态
        expect(sel).not.toContain(","); // 单选择器,不藏并集
      }
    }
  });

  it("antd/element-plus 已注册", () => {
    expect(UI_LIBRARIES.map((l) => l.name)).toEqual(expect.arrayContaining(["antd", "element-plus"]));
  });
});

describe("通用子串层槽位", () => {
  it("关键槽位非空且为合法选择器串", () => {
    for (const key of [
      "dropdownTriggerParts", "dropdownOptionRows", "dropdownOptionEnumeration",
      "dropdownClearButtons", "dropdownRemoveButtons", "emptyStates",
      "formItemContainers", "formItemContainersStrict", "formItemHosts",
      "formItemLabels", "formLabelSimple",
    ] as const) {
      expect((GENERIC as Record<string, unknown>)[key]).toBeTruthy();
    }
    expect(GENERIC.dialogWords.length).toBe(3);
    expect(GENERIC.dialogExcludedParts).toContain("mask");
  });

  it("三个 form-item 容器变体语义分工如实保留(宽松/严格分隔符/宿主判定)", () => {
    expect(GENERIC.formItemContainers).toContain("[role='group']");
    expect(GENERIC.formItemContainers).toContain("form");
    expect(GENERIC.formItemContainersStrict).toContain("[class*='-form-item']");
    expect(GENERIC.formItemContainersStrict).not.toContain("[role='group']");
    expect(GENERIC.formItemHosts.startsWith("label")).toBe(true);
  });
});

describe("合成器(纯函数)", () => {
  it("composeDialogFuzzy:子串词 + 连字符/双下划线双命名排除", () => {
    const fuzzy = composeDialogFuzzy();
    expect(fuzzy).toContain("[class*='modal']:not([style*='display: none'])");
    expect(fuzzy).toContain(":not([class*='modal-mask']):not([class*='modal__mask'])");
    expect(fuzzy).toContain(":not([class*='dialog-footer']):not([class*='dialog__footer'])");
  });

  it("dropdownFloatSelectors / dropdownOptionRowsOf:库精确层在前,通用子串层兜底", () => {
    const floats = dropdownFloatSelectors();
    expect(floats[0]).toContain(".ant-select-dropdown");
    expect(floats.some((s) => s.startsWith("[class*='select-dropdown']"))).toBe(true);
    expect(floats.some((s) => s.startsWith("[class*='popper']"))).toBe(true);
    const rows = dropdownOptionRowsOf();
    expect(rows.some((s) => s.startsWith(".ant-select-item-option"))).toBe(true);
    expect(rows.some((s) => s.startsWith("[class*='item-option']"))).toBe(true);
  });

  it("扩展模拟:追加新库 spec,聚合自动增长(新增 UI 库 = 追加一个对象)", () => {
    const naiveUi: UILibrarySpec = {
      name: "naive-ui",
      modalContainers: [".n-modal-container"],
      drawerContainers: [".n-drawer-container"],
      dropdownContainers: [".n-base-select-menu"],
      dropdownOptions: [".n-base-select-option"],
    };
    const dialogs = dialogContainersOf([...UI_LIBRARIES, naiveUi]);
    expect(dialogs).toContain(".n-modal-container");
    expect(dialogs).toContain(".n-drawer-container");
    expect(dialogs.length).toBe(LIBRARY_DIALOG_CONTAINERS.length + 2);
    expect(dropdownFloatSelectors([...UI_LIBRARIES, naiveUi]).some((s) => s.startsWith(".n-base-select-menu"))).toBe(true);
  });
});

describe("行为保持快照(与抽取前逐字符等价)", () => {
  it("DROPDOWN_OPTION_SELECTOR 与旧实现字符串完全一致", () => {
    expect(DROPDOWN_OPTION_SELECTOR).toBe(
      "[role='option'], [role='menuitem'], [class*='select'][class*='dropdown'] [class*='option'], [class*='select'][class*='dropdown'] [class*='item'], [role='listbox'] [role='option']",
    );
  });

  it("弹窗并集包含旧实现的全部成员(标准层 + 库精确层 + 模糊层)", () => {
    for (const member of [
      "[role='dialog']:not([style*='display: none'])",
      "[aria-modal='true']:not([style*='display: none'])",
      "dialog[open]",
      ".ant-modal:not([style*='display: none'])",
      ".ant-modal-content:not([style*='display: none'])",
      ".el-dialog:not([style*='display: none'])",
      ".ant-drawer:not([style*='display: none'])",
      ".ant-drawer-content-wrapper:not([style*='display: none'])",
      ".el-drawer:not([style*='display: none'])",
      "[class*='modal']:not([style*='display: none'])",
      "[class*='drawer']:not([style*='display: none'])",
      "[class*='dialog']:not([style*='display: none'])",
    ]) {
      expect(ACTIVE_DIALOG_SELECTORS).toContain(member);
    }
    // 精确层与模糊层无互相渗透
    expect(DIALOG_PRECISE_SELECTORS).not.toContain("[class*='modal']");
    expect(DIALOG_FUZZY_SELECTORS).not.toContain(".ant-modal");
  });
});

describe("walker 页内副本 drift-guard", () => {
  it("walker 核心源的表单词表与注册表 token 一致(页内单一来源副本不漂移)", () => {
    expect(WALKER_CORE_SRC.length).toBeGreaterThan(1000);
    for (const token of WALKER_FORM_TOKENS) {
      expect(WALKER_CORE_SRC).toContain(token);
    }
  });
});
