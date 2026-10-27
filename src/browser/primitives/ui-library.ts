// dsh-browser · UI 适配选择器注册表 (UI Library & Generic Selector Registry)
//
// 组件库选择器知识的单一来源,两层知识在此集中:
//   1. 库精确层(UILibrarySpec):每库的容器/选项类名,新增 UI 库 = 追加一个 spec;
//   2. 通用子串层(GENERIC):跨库子串启发式(form-item / select-dropdown / popper /
//      modal 等),未注册的库靠它兜底工作。
// 标准层(WAI-ARIA:role=dialog/listbox/option 等)不在此列——任何库与原生实现
// 通用,直接写在各原语里。
//
// 消费方:primitives/dialog.ts(弹窗仲裁)、primitives/select.ts(下拉状态机)、
// primitives/form.ts、primitives/dom.ts(label 反查)、tools/common.ts
// (DROPDOWN_OPTION_SELECTOR)、tools/inspection.ts(elements 工具 label 解析,
// 经 evaluate payload 注入页内)。walker 核心内的表单容器词表是页内副本
// (单一来源约定),靠 WALKER_CORE_SRC drift-guard 测试锁住一致性。
//
// 行为保持约定:当前注册条目与抽取前的命中集严格等价;有意不收编会扩大命中面
// 的条目(如 .ant-dropdown / .el-popper)。扩展新库时请配套真页面 e2e。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 通用子串层(跨库启发式;值为精确复刻抽取前的各消费点字符串)
// ---------------------------------------------------------------------------

export const GENERIC = {
  // —— 弹窗模糊层:子串词 + 子节点排除词(连字符与双下划线双命名习惯)——
  dialogWords: ["modal", "drawer", "dialog"] as const,
  dialogExcludedParts: [
    "mask", "wrap", "root", "header", "footer", "title", "close", "body", "btn",
  ] as const,

  // —— 下拉 ——
  /** 下拉触发器内部件(点它展开) */
  dropdownTriggerParts: "[class*='selector'], [role='combobox']",
  /** 下拉浮层容器的子串词(portal 挂载的面板) */
  dropdownFloatWords: ["select-dropdown", "popper"] as const,
  /** 通用下拉选项行(select 状态机消费;库精确层另补) */
  dropdownOptionRows:
    "[class*='item-option']:not([class*='empty']), [class*='select-dropdown'] li:not([class*='empty'])",
  /** 可交互「选项」枚举(elements 工具下拉选项清单消费) */
  dropdownOptionEnumeration: [
    "[role='option']",
    "[role='menuitem']",
    "[class*='select'][class*='dropdown'] [class*='option']",
    "[class*='select'][class*='dropdown'] [class*='item']",
    "[role='listbox'] [role='option']",
  ].join(", "),
  /** 多选标签清除按钮 */
  dropdownClearButtons: "[class*='clear'], [aria-label*='clear']",
  /** 多选标签移除按钮 */
  dropdownRemoveButtons: "[class*='remove'], [class*='close'], [aria-label*='close']",
  /** 空态指示器 */
  emptyStates: "[class*='empty'], [class*='no-data'], [role='status'], [class*='item-empty']",

  // —— 表单(三个变体语义不同,如实分槽)——
  /** 表单项容器(宽松:BEM/-item 子串 + group + form 元素;label 反查主用) */
  formItemContainers: "[class*='form-item'], [class*='form__item'], [role='group'], form, .form-group",
  /**
   * 表单项容器(严格:带分隔符前缀,避免 platform-item 之类无关门类误命中;
   * elements 工具页内 labelOf 消费)
   */
  formItemContainersStrict: "[class*='-form-item'], [class*='__form-item'], form, .form-group",
  /** 表单项宿主判定(目标是否处于表单语境;含 label 本身) */
  formItemHosts: "label, [class*='form-item'], [class*='form__item'], [class*='form-group']",
  /** 表单项 label(dom 原语 label 反查消费) */
  formItemLabels: "[class*='form-item-label'], [class*='form-item__label'], [class*='label'], label",
  /** 表单 label(简化集;elements 工具页内 labelOf 消费) */
  formLabelSimple: "[class*='label'], label",
} as const;

// ---------------------------------------------------------------------------
// 库精确层
// ---------------------------------------------------------------------------

export interface UILibrarySpec {
  /** 库标识(诊断与文档)。 */
  name: string;
  /** 模态弹窗容器(参与顶层仲裁的容器级节点)。 */
  modalContainers: string[];
  /** 抽屉容器。 */
  drawerContainers: string[];
  /** 下拉浮层容器(portal 挂载的下拉面板)。 */
  dropdownContainers: string[];
  /** 下拉选项行。 */
  dropdownOptions: string[];
}

/**
 * antd(v4/v5 命名一致)。条目与通用子串层命中集等价:
 * .ant-select-dropdown ⊆ [class*='select-dropdown'];.ant-select-item-option
 * 带 role=option,由标准层覆盖。
 */
const antd: UILibrarySpec = {
  name: "antd",
  modalContainers: [".ant-modal", ".ant-modal-content"],
  drawerContainers: [".ant-drawer", ".ant-drawer-content-wrapper"],
  dropdownContainers: [".ant-select-dropdown"],
  dropdownOptions: [".ant-select-item-option"],
};

/** Element Plus(el-select-dropdown__item 是 li,通用层 [class*='select-dropdown'] li 已覆盖)。 */
const elementPlus: UILibrarySpec = {
  name: "element-plus",
  modalContainers: [".el-dialog"],
  drawerContainers: [".el-drawer"],
  dropdownContainers: [".el-select-dropdown"],
  dropdownOptions: [".el-select-dropdown__item"],
};

/**
 * 注册新库(示例:naive-ui):
 *   const naiveUi: UILibrarySpec = {
 *     name: "naive-ui",
 *     modalContainers: [".n-modal-container"],
 *     drawerContainers: [".n-drawer-container"],
 *     dropdownContainers: [".n-base-select-menu"],
 *     dropdownOptions: [".n-base-select-option"],
 *   };
 * 追加到 UI_LIBRARIES 即可,弹窗顶层仲裁与下拉浮层发现自动获得该库精确层支持;
 * 未注册的库仍由通用子串层兜底。配套要求:补一个该库真页面的 e2e
 * (playground 模式照抄 test:enterprise),防止想当然的类名污染仲裁。
 */
export const UI_LIBRARIES: readonly UILibrarySpec[] = [antd, elementPlus];

type SpecArrayKey = "modalContainers" | "drawerContainers" | "dropdownContainers" | "dropdownOptions";

const flatOf = (libs: readonly UILibrarySpec[], key: SpecArrayKey): string[] =>
  libs.flatMap((lib) => lib[key]);

// ---------------------------------------------------------------------------
// 合成器(纯函数,导出供测试;预组合常量供消费方)
// ---------------------------------------------------------------------------

/** 弹窗/抽屉容器(库精确层原料,未加 display:none 预过滤)。 */
export function dialogContainersOf(libs: readonly UILibrarySpec[] = UI_LIBRARIES): string[] {
  return [...flatOf(libs, "modalContainers"), ...flatOf(libs, "drawerContainers")];
}

/** 弹窗模糊层选择器串:子串词 + 子节点排除(:not 双命名)+ display:none 预过滤。 */
export function composeDialogFuzzy(
  words: readonly string[] = GENERIC.dialogWords,
  excludedParts: readonly string[] = GENERIC.dialogExcludedParts,
): string {
  return words
    .map((word) =>
      [
        `[class*='${word}']:not([style*='display: none'])`,
        ...excludedParts.map((part) => `:not([class*='${word}-${part}']):not([class*='${word}__${part}'])`),
      ].join(""),
    )
    .join(", ");
}

/** 下拉浮层容器选择器列表(库精确层 + 通用子串层,均带 display:none 预过滤)。 */
export function dropdownFloatSelectors(libs: readonly UILibrarySpec[] = UI_LIBRARIES): string[] {
  return [
    ...flatOf(libs, "dropdownContainers"),
    ...GENERIC.dropdownFloatWords.map((w) => `[class*='${w}']`),
  ].map((sel) => `${sel}:not([style*='display: none']):not([class*='hidden'])`);
}

/** 下拉选项行选择器列表(标准层 role=option 由消费方自带 + 库精确层 + 通用子串层)。 */
export function dropdownOptionRowsOf(libs: readonly UILibrarySpec[] = UI_LIBRARIES): string[] {
  return [...flatOf(libs, "dropdownOptions").map((sel) => `${sel}:not([class*='empty'])`), GENERIC.dropdownOptionRows];
}

/** 预组合聚合常量(消费方直接 import)。 */
export const LIBRARY_DIALOG_CONTAINERS: readonly string[] = dialogContainersOf();
export const LIBRARY_DROPDOWN_CONTAINERS: readonly string[] = dropdownFloatSelectors();
export const LIBRARY_DROPDOWN_OPTIONS: readonly string[] = dropdownOptionRowsOf();

/** walker 核心源里应包含的表单词表 token(drift-guard 测试用,见 test/ui-library.test.ts)。 */
export const WALKER_FORM_TOKENS: readonly string[] = [
  "form-item",
  "form__item",
  "form-group",
  "form-item-label",
  "form-item__label",
];
