import { waitForDOMQuiescence } from "./quiescence.js";
import { fillDateRangeHelper } from "./modules/temporal.js";
import { selectPathHelper } from "./modules/hierarchy.js";
import { transferItemsHelper } from "./modules/transfer.js";
import { extractVirtualListHelper } from "./modules/virtual.js";
import { fillEditorHelper } from "./modules/editor.js";
import { dragAndDropHelper } from "./modules/drag.js";
export class AntDesignAdapter {
    name = "ant-design";
    /** 活动弹窗/抽屉选择器 */
    activeDialogSelector = ".ant-modal:not([style*='display: none']), .ant-drawer:not([style*='display: none'])";
    /** 探测当前页面是否使用了 Ant Design 体系 */
    async matches(page) {
        try {
            return await page.evaluate(() => {
                return Boolean(document.querySelector("[class*='ant-'], #__ANTD_PRO__"));
            });
        }
        catch {
            return false;
        }
    }
    /** 语义抽取钩子 (注意：函数将在页内自包含执行，不得引用外部闭包) */
    extractionHook = {
        resolveName(el, role) {
            // 1. 包裹型单选/复选/开关控件 (.ant-radio-wrapper, .ant-checkbox-wrapper, .ant-switch)
            if (["checkbox", "radio", "switch"].includes(role)) {
                const wrap = el.closest("label, .ant-radio-wrapper, .ant-checkbox-wrapper, .ant-transfer-list-content-item, [class*='wrapper']");
                if (wrap) {
                    const t = (wrap.textContent || "").trim().replace(/\s+/g, " ");
                    if (t)
                        return t.slice(0, 60);
                }
            }
            // 2. 表单项标签反查: 控件位于 .ant-form-item 内部时，反向提取对应的 .ant-form-item-label
            const formItem = el.closest(".ant-form-item");
            if (formItem) {
                const labelEl = formItem.querySelector(".ant-form-item-label, label");
                if (labelEl && (typeof labelEl.contains !== "function" || !labelEl.contains(el))) {
                    const txt = (labelEl.textContent || "").trim().replace(/\s+/g, " ");
                    if (txt)
                        return txt.slice(0, 60);
                }
            }
            // 3. 弹窗/抽屉浮层标题反查
            if (role === "dialog") {
                const titleEl = el.querySelector(".ant-modal-title, .ant-drawer-title");
                if (titleEl) {
                    const txt = (titleEl.textContent || "").trim().replace(/\s+/g, " ");
                    if (txt)
                        return txt.slice(0, 60);
                }
            }
            return null;
        },
        resolveRole(el) {
            const cls = el.className;
            if (typeof cls === "string") {
                if (cls.includes("ant-tabs-tab-btn") || cls.includes("ant-tabs-tab"))
                    return "tab";
                if (cls.includes("ant-btn"))
                    return "button";
                if (cls.includes("ant-select-item-option"))
                    return "option";
                if (cls.includes("ant-table-row"))
                    return "row";
            }
            return null;
        },
        checkVisible(el) {
            // 优先利用原生 checkVisibility 避免重排回流
            if ("checkVisibility" in el) {
                const ok = el.checkVisibility({
                    checkOpacity: true,
                    checkVisibilityCSS: true,
                });
                if (!ok)
                    return false;
            }
            // 检查 Ant Design 特异性隐藏类名
            const cls = el.className;
            if (typeof cls === "string") {
                if (cls.includes("-hidden") ||
                    cls.includes("ant-modal-wrap-hidden") ||
                    cls.includes("ant-select-dropdown-hidden")) {
                    return false;
                }
            }
            return null;
        },
    };
    /** 交互动作拦截器 (主机侧执行) */
    actionInterceptor = {
        async beforeAction(ctx) {
            if (ctx.action !== "click")
                return;
            // 目标提升(Target Lifting)：若点击的是被零尺寸隐藏的原生 input，提升至其外部可交互 wrapper
            try {
                const isHiddenInput = await ctx.target.evaluate((el) => {
                    if (el.tagName.toLowerCase() !== "input")
                        return false;
                    const type = (el.getAttribute("type") || "").toLowerCase();
                    if (type !== "checkbox" && type !== "radio")
                        return false;
                    const rect = el.getBoundingClientRect();
                    const wrapper = el.closest(".ant-checkbox-wrapper, .ant-radio-wrapper");
                    return Boolean(wrapper && (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).opacity === "0"));
                });
                if (isHiddenInput) {
                    // 提升至上层可见的 wrapper 点击
                    return ctx.target.locator("xpath=ancestor::*[contains(@class, '-wrapper')][1]");
                }
            }
            catch {
                // 评估失败忽略，按原 target 执行
            }
        },
        async onActionError(ctx, error) {
            const msg = error.message;
            // 自愈策略 1: 遮罩层拦截 (intercepts pointer events)
            if (msg.includes("intercepts pointer events")) {
                const isMask = msg.includes("ant-modal-wrap") ||
                    msg.includes("ant-modal-mask") ||
                    msg.includes("ant-drawer-mask");
                if (isMask) {
                    // 方案 A：如果是遮罩正在淡出动画，快速等待 100ms
                    await ctx.page.waitForTimeout(100);
                    // 方案 B：重试使用 force: true 穿透拦截
                    return {
                        handled: true,
                        retryWith: { force: true, timeoutMs: 3000 },
                    };
                }
            }
            return { handled: false };
        },
    };
    /** 页面稳态等待 */
    async waitForQuiescence(page, options) {
        return waitForDOMQuiescence(page, { quietMs: 80, maxTimeoutMs: 2000, ...options });
    }
    /** 判断是否匹配 Ant Design 下拉触发器 */
    async matchesSelect(ctx) {
        return ctx.target
            .evaluate((el) => {
            if (el.closest(".ant-select, .ant-select-selector"))
                return true;
            const id = el.id || "";
            const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "";
            return /^rc_select_/.test(id) || /^rc_select_/.test(controls);
        })
            .catch(() => false);
    }
    /** 执行 Ant Design 下拉选择 */
    async selectOption(ctx) {
        const { target, page, want, exact, timeout, label } = ctx;
        const probe = Math.min(timeout, 5_000);
        // 检查是否已经处于展开状态(避免重复点击误收起)
        const isExpanded = await target
            .evaluate((el) => {
            if (el.getAttribute("aria-expanded") === "true")
                return true;
            const host = el.closest(".ant-select");
            if (host && host.classList.contains("ant-select-open"))
                return true;
            if (host?.getAttribute("aria-expanded") === "true")
                return true;
            const inner = host?.querySelector('input[role="combobox"], [aria-expanded]');
            if (inner?.getAttribute("aria-expanded") === "true")
                return true;
            const controlsId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
            if (controlsId) {
                const dd = document.getElementById(controlsId);
                if (dd && dd.offsetParent !== null)
                    return true;
            }
            return false;
        })
            .catch(() => false);
        if (!isExpanded) {
            const clickTarget = target.locator(".ant-select-selector").first();
            if ((await clickTarget.count().catch(() => 0)) > 0) {
                await clickTarget.click({ timeout: 2000 }).catch(async () => {
                    await target.click({ timeout: 2000, force: true });
                });
            }
            else {
                await target.click({ timeout: 2000 }).catch(async () => {
                    await target.click({ timeout: 2000, force: true });
                });
            }
            await page.waitForTimeout(120);
        }
        // 定位选项:优先通过 controlsId 关联所在的 .ant-select-dropdown 浮层,
        // 优先选择真实视觉交互项 .ant-select-item-option(如有),无时降级到 [role='option'](排除 0 宽度傀儡节点)
        const controlsId = await target
            .evaluate((el) => el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "")
            .catch(() => "");
        let options = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not([style*='display: none']) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden):not([style*='display: none']) [role='option']:not([style*='height: 0px'])");
        if (controlsId) {
            const parentDropdown = page.locator(`xpath=//*[@id='${controlsId}']/ancestor-or-self::*[contains(@class, 'ant-select-dropdown')][1]`);
            const visual = parentDropdown.locator(".ant-select-item-option");
            if ((await visual.count().catch(() => 0)) > 0) {
                options = visual;
            }
            else {
                const roleOpt = parentDropdown.locator("[role='option']:not([style*='height: 0px'])");
                if ((await roleOpt.count().catch(() => 0)) > 0) {
                    options = roleOpt;
                }
            }
        }
        await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => { });
        // 读取文本候选:覆盖 innerText, title, aria-label
        const entries = await options
            .evaluateAll((els) => els.map((el) => {
            const h = el;
            const text = (h.innerText || el.textContent || "").trim();
            const title = el.getAttribute("title") || "";
            const aria = el.getAttribute("aria-label") || "";
            return { text, title, aria };
        }))
            .catch(() => []);
        const visibleTexts = entries.map((e) => e.text || e.title || e.aria).filter(Boolean);
        if (visibleTexts.length === 0) {
            throw new Error(`点击 ${label} 后未出现 Ant Design 下拉选项`);
        }
        const index = entries.findIndex((e) => {
            const candidates = [e.text, e.title, e.aria].filter(Boolean);
            return exact ? candidates.some((c) => c === want) : candidates.some((c) => c.includes(want));
        });
        if (index === -1) {
            await target.click({ timeout: 1000 }).catch(() => { });
            throw new Error(`下拉选项中无 "${want}";可见选项: ${visibleTexts.join(" / ")}`);
        }
        // 三级降级点击(常规 -> force -> 原生 DOM click)
        const chosen = options.nth(index);
        try {
            await chosen.click({ timeout: Math.min(probe, 2_000) });
        }
        catch {
            try {
                await chosen.click({ timeout: 1_500, force: true });
            }
            catch {
                await chosen.evaluate((el) => {
                    el.scrollIntoView?.({ block: "nearest" });
                    el.click();
                });
            }
        }
        return { selected: visibleTexts[index] };
    }
    /** Ant Design 表单项精准识别与填充 */
    async fillFormField(page, field, scope) {
        const root = scope ? page.locator(scope) : page;
        const { key, value } = field;
        try {
            // 1. 定位包含对应 Label 的 .ant-form-item
            const formItems = root.locator(".ant-form-item");
            const count = await formItems.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                const item = formItems.nth(i);
                const labelEl = item.locator("label, .ant-form-item-label").first();
                let labelText = (await labelEl.innerText().catch(() => "")) || (await labelEl.textContent().catch(() => "")) || "";
                labelText = labelText.trim();
                if (labelText.includes(key)) {
                    // 检查内部控件类型
                    // A. 下拉选择器 .ant-select
                    const antSelect = item.locator(".ant-select").first();
                    if ((await antSelect.count().catch(() => 0)) > 0) {
                        await this.selectOption({
                            page,
                            target: antSelect,
                            label: key,
                            want: String(value),
                            exact: false,
                            timeout: 5000,
                        });
                        return { handled: true };
                    }
                    // B. 日期与范围选择器 .ant-picker
                    const antPicker = item.locator(".ant-picker").first();
                    if ((await antPicker.count().catch(() => 0)) > 0) {
                        const handled = await fillDateRangeHelper(page, antPicker, value);
                        if (handled)
                            return { handled: true };
                    }
                    // C. 级联选择器 .ant-cascader
                    const antCascader = item.locator(".ant-cascader, .ant-cascader-picker").first();
                    if ((await antCascader.count().catch(() => 0)) > 0 && Array.isArray(value)) {
                        const handled = await selectPathHelper(page, antCascader, value);
                        if (handled)
                            return { handled: true };
                    }
                    // D. 开关控件 .ant-switch
                    const antSwitch = item.locator(".ant-switch").first();
                    if ((await antSwitch.count().catch(() => 0)) > 0) {
                        const isChecked = await antSwitch
                            .evaluate((el) => el.getAttribute("aria-checked") === "true")
                            .catch(() => false);
                        if (Boolean(value) !== isChecked) {
                            await antSwitch.click();
                        }
                        return { handled: true };
                    }
                    // E. 普通输入框 / 文本域 / 数字输入框
                    const input = item.locator("input, textarea").first();
                    if ((await input.count().catch(() => 0)) > 0) {
                        await input.fill(String(value));
                        return { handled: true };
                    }
                }
            }
        }
        catch (err) {
            return { handled: false, error: err.message };
        }
        return { handled: false };
    }
    async fillDate(ctx, field, dateValue) {
        return fillDateRangeHelper(ctx.page, field, dateValue);
    }
    async selectPath(ctx, field, path) {
        return selectPathHelper(ctx.page, field, path);
    }
    async transferItems(ctx, selector, direction, items) {
        return transferItemsHelper(ctx.page, selector, direction, items);
    }
    async extractVirtualList(page, options) {
        return extractVirtualListHelper(page, options);
    }
    async fillEditorContent(ctx, selector, content) {
        return fillEditorHelper(ctx.page, selector, content);
    }
    async dragAndDrop(ctx, sourceSelector, targetSelector) {
        return dragAndDropHelper(ctx.page, sourceSelector, targetSelector);
    }
}
//# sourceMappingURL=antd.js.map