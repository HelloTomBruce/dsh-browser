// dsh-browser · 通用下拉选择状态机原语 (Universal Portal Select Primitive)
import type { Locator } from "playwright-core";
import { withTimeout } from "../tools/common.js";
import { waitForDOMQuiescence } from "./dom.js";
import type { SelectContext, SelectResult } from "./types.js";

/**
 * 通用下拉选择原语
 * 适用于原生 HTML <select> 及各类通过 Portal 挂载在 body 根节点的非标合成下拉组件
 */
export async function executeUniversalSelect(ctx: SelectContext): Promise<SelectResult> {
  const { target, page, want, exact, timeout = 10_000, label = "select", clear } = ctx;
  const probe = Math.min(timeout, 5_000);

  // 1. 原生 HTML <select> 标签快速支持
  const tag = await withTimeout(
    target.evaluate((el) => el.tagName.toLowerCase()),
    2_000,
    "检查原生 select 标签",
  ).catch(() => "");

  if (tag === "select") {
    try {
      await target.selectOption({ label: want }, { timeout });
      return { selected: want };
    } catch {
      const options = await withTimeout(
        target.locator("option").allTextContents(),
        probe,
        "读取原生下拉选项",
      ).catch(() => [] as string[]);
      throw new Error(
        `原生下拉无选项 "${want}"; 可用选项: ${options.map((t) => t.trim()).join(" / ")}`,
      );
    }
  }

  // 2. 规范化 target:
  // a) 若定位到的是 label 或 form-item 容器、前置文本 span/td 等，下钻或寻获关联的下拉组件
  let resolvedTarget = target;
  const isLabelOrContainer = await withTimeout(
    target.evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "label") return true;
      const cls = typeof el.className === "string" ? el.className : "";
      if (/(?:form-item|form__item|form-group)/i.test(cls)) return true;
      if (el.closest("label, [class*='form-item'], [class*='form__item'], [class*='form-group']")) {
        return !el.matches("[role='combobox'], select, [class*='select-selector']");
      }
      // 非标文本节点 (如 span/div/td/th)
      if (!el.matches("[role='combobox'], select, [class*='select'], [class*='selector']")) {
        return true;
      }
      return false;
    }),
    1_500,
    "探测 label 或非标文本容器",
  ).catch(() => false);

  if (isLabelOrContainer) {
    const descendantSelect = target.locator(
      "xpath=.//*[@role='combobox' or self::select or contains(@class, 'select-selector') or contains(@class, 'select')][not(self::label)]",
    ).first();
    if ((await descendantSelect.count().catch(() => 0)) > 0) {
      resolvedTarget = descendantSelect;
    } else {
      const forId = await target.getAttribute("for").catch(() => null);
      if (forId) {
        const forTarget = page.locator(`[id="${forId.replace(/"/g, '\\"')}"]`).first();
        if ((await forTarget.count().catch(() => 0)) > 0) {
          resolvedTarget = forTarget;
        }
      } else {
        // 尝试 1: 后续相邻兄弟组件 (<span>地市:</span> <a-select ...>)
        const nextSiblingSelect = target.locator(
          "xpath=following-sibling::*[self::select or @role='combobox' or contains(@class, 'select') or contains(@class, 'selector')][1] | following-sibling::*[1]//*[@role='combobox' or self::select or contains(@class, 'select')]",
        ).first();
        if ((await nextSiblingSelect.count().catch(() => 0)) > 0) {
          resolvedTarget = nextSiblingSelect;
        } else {
          // 尝试 2: 表格相邻单元格 (<td>地市</td> <td><select>...</td>)
          const tdSiblingSelect = target.locator(
            "xpath=ancestor-or-self::td[1]/following-sibling::td[1]//*[@role='combobox' or self::select or contains(@class, 'select')]",
          ).first();
          if ((await tdSiblingSelect.count().catch(() => 0)) > 0) {
            resolvedTarget = tdSiblingSelect;
          } else {
            // 尝试 3: 同一表单项容器或父容器兄弟控件
            const siblingSelect = target.locator(
              "xpath=ancestor-or-self::*[contains(@class, 'form-item') or contains(@class, 'form__item') or contains(@class, 'form-group')][1]//*[@role='combobox' or self::select or contains(@class, 'select-selector') or contains(@class, 'select')][not(self::label)] | ..//*[@role='combobox' or self::select or contains(@class, 'select-selector') or contains(@class, 'select')][not(self::label)]",
            ).first();
            if ((await siblingSelect.count().catch(() => 0)) > 0) {
              resolvedTarget = siblingSelect;
            }
          }
        }
      }
    }
  }

  // b) 若定位到的是组件内部 input 或 search 节点，自动向上提升到 combobox 外层宿主
  const hostLocator = resolvedTarget.locator(
    "xpath=ancestor-or-self::*[@role='combobox' or contains(@class, 'select') or contains(@class, 'selector')][last()]",
  );
  const actualTarget = (await hostLocator.count().catch(() => 0)) > 0 ? hostLocator.first() : resolvedTarget;

  // 3. 多选清理支持 (当指定 clear: true 时先清除已有选中标签)
  if (clear) {
    try {
      const clearBtn = actualTarget.locator("[class*='clear'], [aria-label*='clear']").first();
      if ((await clearBtn.count().catch(() => 0)) > 0 && (await clearBtn.isVisible().catch(() => false))) {
        await clearBtn.click({ timeout: 1000 }).catch(() => {});
      } else {
        const removeBtns = actualTarget.locator("[class*='remove'], [class*='close'], [aria-label*='close']");
        const removeCount = await removeBtns.count().catch(() => 0);
        for (let i = 0; i < removeCount; i++) {
          await removeBtns.nth(0).click({ timeout: 500 }).catch(() => {});
        }
      }
    } catch {
      // 忽略清理异常
    }
  }

  // 4. 状态判定：检查当前是否已处于展开状态
  const isExpanded = await withTimeout(
    actualTarget.evaluate((el) => {
      if (el.getAttribute("aria-expanded") === "true") return true;
      const host = el.closest("[role='combobox'], [class*='select']") || el;
      if (host && host.getAttribute("aria-expanded") === "true") return true;
      const cls = (host?.className || "") + " " + (el.className || "");
      if (/\b(?:open|is-focus|is-active)\b/i.test(cls) || cls.includes("-open")) return true;

      const inner = host?.querySelector("input[role='combobox'], [aria-expanded]");
      if (inner?.getAttribute("aria-expanded") === "true") return true;

      const controlsId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      if (controlsId) {
        const dd = document.getElementById(controlsId);
        if (dd && dd.offsetParent !== null) return true;
      }
      return false;
    }),
    2_000,
    "检查下拉展开状态",
  ).catch(() => false);

  // 5. 点击展开下拉浮层
  if (!isExpanded) {
    const triggerChild = actualTarget.locator("[class*='selector'], [role='combobox']").first();
    let clicked = false;
    if ((await triggerChild.count().catch(() => 0)) > 0) {
      await triggerChild.click({ timeout: 2000 }).catch(async () => {
        await actualTarget.click({ timeout: 2000, force: true });
      });
      clicked = true;
    }
    if (!clicked) {
      await actualTarget.click({ timeout: 2000 }).catch(async () => {
        await actualTarget.click({ timeout: 2000, force: true });
      });
    }
    await page.waitForTimeout(120);
  }

  // 6. 定位关联的浮层容器: 支持 aria-controls 绑定与 Portal 浮层定位
  const controlsId = await withTimeout(
    actualTarget.evaluate((el) => {
      const direct = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      if (direct) return direct;
      const host = el.closest("[class*='select']") || el;
      const inner = host?.querySelector("input[role='combobox'], [aria-controls], [aria-owns]");
      return (
        inner?.getAttribute("aria-controls") ||
        inner?.getAttribute("aria-owns") ||
        host?.getAttribute("aria-controls") ||
        ""
      );
    }),
    2_000,
    "解析下拉关联 controlsId",
  ).catch(() => "");

  const optionSelector =
    "[role='option']:not([style*='height: 0px']):not([class*='empty']), [class*='item-option']:not([class*='empty']), [class*='select-dropdown'] li:not([class*='empty'])";
  const dropdownSelector =
    "[role='listbox']:not([style*='display: none']), [class*='select-dropdown']:not([style*='display: none']):not([class*='hidden']), [class*='popper']:not([style*='display: none'])";

  let options: Locator;
  let targetDropdown: Locator | null = null;
  if (controlsId) {
    const parentDropdown = page.locator(
      `xpath=//*[@id='${controlsId}']/ancestor-or-self::*[contains(@class, 'dropdown') or contains(@class, 'popper') or @role='listbox'][1] | //*[contains(@class, 'dropdown') or @role='listbox'][.//*[@id='${controlsId}']]`,
    );
    targetDropdown = parentDropdown.first();
    const visual = parentDropdown.locator(optionSelector).locator("visible=true");
    options = (await visual.count().catch(() => 0)) > 0 ? visual : parentDropdown.locator(optionSelector);
  } else {
    const activeVisualDropdowns = page.locator(dropdownSelector).locator("visible=true");
    const visualCount = await activeVisualDropdowns.count().catch(() => 0);
    const dropdown = visualCount > 1
      ? activeVisualDropdowns.last()
      : visualCount === 1
        ? activeVisualDropdowns.first()
        : page.locator(dropdownSelector).last();
    targetDropdown = dropdown;
    const visual = dropdown.locator(optionSelector).locator("visible=true");
    options = (await visual.count().catch(() => 0)) > 0 ? visual : dropdown.locator(optionSelector);
  }

  await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => {});

  // 7. 读取候选选项文本
  const entries = await options
    .evaluateAll((els) =>
      els.map((el) => {
        const h = el as HTMLElement;
        const text = (h.innerText || el.textContent || "").trim();
        const title = el.getAttribute("title") || "";
        const aria = el.getAttribute("aria-label") || "";
        return { text, title, aria };
      }),
    )
    .catch(() => [] as { text: string; title: string; aria: string }[]);

  const visibleTexts = entries.map((e) => e.text || e.title || e.aria).filter(Boolean);

  // 8. 空数据诊断与安全收起 (严禁使用全局 Escape 避免误关外层弹窗)
  if (visibleTexts.length === 0) {
    const emptySelector = "[class*='empty'], [class*='no-data'], [role='status'], [class*='item-empty']";
    const isEmpty = targetDropdown !== null
      ? await targetDropdown.locator(emptySelector).first().isVisible().catch(() => false)
      : false;
    await actualTarget.click({ timeout: 1000 }).catch(() => {});
    if (isEmpty) {
      throw new Error(`下拉浮层当前无选项(数据为空态/无可选数据): ${label}`);
    }
    throw new Error(`点击 ${label} 后未出现下拉选项(选项列表为空态)`);
  }

  // 9. 选项匹配: 精准 -> 去空格 -> 大小写不敏感 -> 包含匹配
  const wantStripped = want.replace(/\s+/g, "");
  let index = visibleTexts.findIndex((t) => t === want);
  if (index === -1) {
    index = visibleTexts.findIndex((t) => t.replace(/\s+/g, "") === wantStripped);
  }
  if (index === -1) {
    index = visibleTexts.findIndex((t) => t.toLowerCase() === want.toLowerCase());
  }
  if (index === -1 && !exact) {
    index = visibleTexts.findIndex(
      (t) => t.includes(want) || want.includes(t) || t.replace(/\s+/g, "").includes(wantStripped),
    );
  }

  if (index === -1) {
    await actualTarget.click({ timeout: 1000 }).catch(() => {});
    throw new Error(
      `在下拉选项中未找到 "${want}". 可用选项: [${visibleTexts.join(", ")}]`,
    );
  }

  // 10. 执行物理点击选中 (具备标准 actionability -> force -> js dispatch 三级自愈)
  const chosenLoc = options.nth(index);
  try {
    await chosenLoc.click({ timeout: 2000 });
  } catch {
    try {
      await chosenLoc.click({ timeout: 1500, force: true });
    } catch {
      await chosenLoc.evaluate((el) => {
        (el as HTMLElement).scrollIntoView?.({ block: "nearest" });
        (el as HTMLElement).click();
      });
    }
  }

  await waitForDOMQuiescence(page, { quietMs: 50, maxTimeoutMs: 1000 }).catch(() => true);
  return { selected: visibleTexts[index] };
}
