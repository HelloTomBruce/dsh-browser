// dsh-browser · 组件库下拉选择适配器 (UI Select Adapters)
// 将不同 UI 组件库(Ant Design, Element Plus, 原生 Select, 通用 ARIA)的特异性展开与选项定位逻辑
// 彻底隔离在适配器内部，保持核心工具层的纯净与无污染。
import { withTimeout } from "../tools/common.js";
/** 1. 原生 HTML <select> 适配器 */
class NativeSelectAdapter {
    name = "native-select";
    async matches(ctx) {
        const probe = Math.min(ctx.timeout, 2_000);
        const tag = await withTimeout(ctx.target.evaluate((el) => el.tagName.toLowerCase()), probe, "检查原生 select 标签").catch(() => "");
        return tag === "select";
    }
    async select(ctx) {
        const probe = Math.min(ctx.timeout, 5_000);
        try {
            await ctx.target.selectOption({ label: ctx.want }, { timeout: ctx.timeout });
            return { selected: ctx.want };
        }
        catch {
            const options = await withTimeout(ctx.target.locator("option").allTextContents(), probe, "读取原生下拉选项").catch(() => []);
            throw new Error(`原生下拉无选项 "${ctx.want}";可用选项: ${options.map((t) => t.trim()).join(" / ")}`);
        }
    }
}
/** 2. Ant Design (React / Vue) 下拉适配器 (rc-select / antd 体系) */
class AntDesignSelectAdapter {
    name = "ant-design";
    async matches(ctx) {
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
    async select(ctx) {
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
            // 优先点击外层 .ant-select-selector 触发容器展开
            const handled = await target
                .evaluate((el) => {
                const selector = (el.closest(".ant-select-selector, .ant-select") || el);
                selector.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                selector.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                selector.click();
                return true;
            })
                .catch(() => false);
            if (!handled) {
                await target.click({ timeout: Math.min(timeout, 10_000) }).catch(async () => {
                    await target.click({ timeout: 2_000, force: true });
                });
            }
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
}
/** 3. Element Plus / Element UI 下拉适配器 */
class ElementPlusSelectAdapter {
    name = "element-plus";
    async matches(ctx) {
        return ctx.target
            .evaluate((el) => !!el.closest(".el-select, .el-select__wrapper"))
            .catch(() => false);
    }
    async select(ctx) {
        const { target, page, want, exact, timeout, label } = ctx;
        const probe = Math.min(timeout, 5_000);
        const isExpanded = await target
            .evaluate((el) => {
            const host = el.closest(".el-select");
            return host?.classList.contains("is-focus") || el.getAttribute("aria-expanded") === "true";
        })
            .catch(() => false);
        if (!isExpanded) {
            await target.click({ timeout: Math.min(timeout, 10_000) }).catch(async () => {
                await target.click({ timeout: 2_000, force: true });
            });
        }
        const options = page.locator(".el-select-dropdown:not([style*='display: none']) .el-select-dropdown__item");
        await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => { });
        const texts = (await withTimeout(options.allTextContents(), probe, "读取 Element 下拉选项").catch(() => [])).map((t) => t.trim()).filter(Boolean);
        if (texts.length === 0) {
            throw new Error(`点击 ${label} 后未出现 Element 下拉选项`);
        }
        const index = texts.findIndex((t) => (exact ? t === want : t.includes(want)));
        if (index === -1) {
            await target.click({ timeout: 1000 }).catch(() => { });
            throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
        }
        const chosen = options.nth(index);
        try {
            await chosen.click({ timeout: Math.min(probe, 2_000) });
        }
        catch {
            await chosen.click({ timeout: 1_500, force: true });
        }
        return { selected: texts[index] };
    }
}
/** 4. 通用标准 ARIA 下拉适配器 (兜底所有其他 combobox / listbox) */
class GenericAriaSelectAdapter {
    name = "generic-aria";
    async matches(_ctx) {
        return true; // 责任链末端兜底
    }
    async select(ctx) {
        const { target, page, want, exact, timeout, label } = ctx;
        const probe = Math.min(timeout, 5_000);
        const isExpanded = await target
            .evaluate((el) => el.getAttribute("aria-expanded") === "true" || el.closest('[role="combobox"]')?.getAttribute("aria-expanded") === "true")
            .catch(() => false);
        if (!isExpanded) {
            await target.click({ timeout: Math.min(timeout, 10_000) }).catch(async () => {
                await target.click({ timeout: 2_000, force: true });
            });
        }
        const options = page.locator("[role='listbox']:not([hidden]):not([style*='display: none']):not([style*='height: 0px']) [role='option']:not([style*='height: 0px'])");
        await options.first().waitFor({ state: "visible", timeout: Math.min(timeout, 5_000) }).catch(() => { });
        const texts = (await withTimeout(options.allTextContents(), probe, "读取通用下拉选项").catch(() => [])).map((t) => t.trim()).filter(Boolean);
        if (texts.length === 0) {
            throw new Error(`点击 ${label} 后未出现下拉选项(非原生 select,也不是已知的组件库下拉)`);
        }
        const index = texts.findIndex((t) => (exact ? t === want : t.includes(want)));
        if (index === -1) {
            await target.click({ timeout: 1000 }).catch(() => { });
            throw new Error(`下拉选项中无 "${want}";可见选项: ${texts.join(" / ")}`);
        }
        const chosen = options.nth(index);
        try {
            await chosen.click({ timeout: Math.min(probe, 2_000) });
        }
        catch {
            try {
                await chosen.click({ timeout: 1_500, force: true });
            }
            catch {
                await chosen.evaluate((el) => el.click());
            }
        }
        return { selected: texts[index] };
    }
}
/** 注册并按优先级排列的适配器列表 */
const SELECT_ADAPTERS = [
    new NativeSelectAdapter(),
    new AntDesignSelectAdapter(),
    new ElementPlusSelectAdapter(),
    new GenericAriaSelectAdapter(),
];
/**
 * 调度器入口:自动根据目标节点特征解析最合适的 UI 适配器执行交互。
 */
export async function executeSelectAdapter(ctx) {
    for (const adapter of SELECT_ADAPTERS) {
        if (await adapter.matches(ctx)) {
            return await adapter.select(ctx);
        }
    }
    // 理论上由 GenericAriaSelectAdapter 兜底，不会到达此处
    throw new Error(`未找到匹配的下拉适配器: ${ctx.label}`);
}
//# sourceMappingURL=select.js.map