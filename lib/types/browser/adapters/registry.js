import { AntDesignAdapter } from "./antd.js";
import { ElementPlusAdapter } from "./element.js";
import { GenericAdapter } from "./generic.js";
class UIAdapterRegistryImpl {
    adapters = new Map();
    pageAdapterCache = new WeakMap();
    constructor() {
        // 默认内置注册通用适配器与主流 UI 适配器
        this.register(new GenericAdapter());
        this.register(new AntDesignAdapter());
        this.register(new ElementPlusAdapter());
    }
    /** 注册新的 UI 适配器插件 */
    register(adapter) {
        this.adapters.set(adapter.name, adapter);
    }
    /** 获取指定适配器 */
    get(name) {
        return this.adapters.get(name);
    }
    /**
     * 自动探测并获取当前页面对应的适配器
     * 结果绑定到 Page 弱引用缓存中，避免重复探测
     */
    async getActiveAdapter(page) {
        const cached = this.pageAdapterCache.get(page);
        if (cached)
            return cached;
        // 优先匹配特异性适配器 (排除 generic 兜底)
        for (const [name, adapter] of this.adapters.entries()) {
            if (name === "generic")
                continue;
            try {
                if (await adapter.matches(page)) {
                    this.pageAdapterCache.set(page, adapter);
                    return adapter;
                }
            }
            catch {
                // 探测失败继续尝试下一个
            }
        }
        const fallback = this.adapters.get("generic");
        this.pageAdapterCache.set(page, fallback);
        return fallback;
    }
    /**
     * 聚合所有已注册适配器的活动弹窗/对话框选择器
     */
    getActiveDialogSelectors() {
        const selectors = [];
        for (const adapter of this.adapters.values()) {
            if (adapter.activeDialogSelector) {
                selectors.push(adapter.activeDialogSelector);
            }
        }
        return selectors.join(", ");
    }
    /**
     * 调度器入口: 自动根据目标节点特征解析最合适的 UI 适配器执行下拉交互
     */
    async executeSelect(ctx) {
        // 1. 优先尝试当前激活适配器
        const active = await this.getActiveAdapter(ctx.page);
        if (active.name !== "generic" && active.matchesSelect && (await active.matchesSelect(ctx))) {
            if (active.selectOption)
                return await active.selectOption(ctx);
        }
        // 2. 遍历其余特异性适配器匹配
        for (const [name, adapter] of this.adapters.entries()) {
            if (name === "generic" || name === active.name)
                continue;
            if (adapter.matchesSelect && (await adapter.matchesSelect(ctx))) {
                if (adapter.selectOption)
                    return await adapter.selectOption(ctx);
            }
        }
        // 3. 通用适配器兜底 (含原生 select 与通用 ARIA)
        const generic = this.adapters.get("generic");
        if (generic?.selectOption) {
            return await generic.selectOption(ctx);
        }
        throw new Error(`未找到匹配的下拉适配器: ${ctx.label}`);
    }
    /**
     * 清理页面的适配器缓存 (通常在页面发生整页导航时调用)
     */
    clearCache(page) {
        this.pageAdapterCache.delete(page);
    }
    /**
     * 动作预处理管道 (执行目标提升等)
     */
    async beforeAction(ctx) {
        const adapter = await this.getActiveAdapter(ctx.page);
        if (adapter.actionInterceptor?.beforeAction) {
            return adapter.actionInterceptor.beforeAction(ctx);
        }
    }
    /**
     * 动作异常自愈管道 (处理遮罩层、阻挡重试等)
     */
    async onActionError(ctx, error) {
        const adapter = await this.getActiveAdapter(ctx.page);
        if (adapter.actionInterceptor?.onActionError) {
            return adapter.actionInterceptor.onActionError(ctx, error);
        }
    }
    /**
     * 表单项智能填充调度：
     * 优先尝试当前匹配的 UI 框架特异性适配器，若未处理则交由通用适配器兜底
     */
    async fillFormField(page, field, scope) {
        const active = await this.getActiveAdapter(page);
        if (active.fillFormField) {
            const res = await active.fillFormField(page, field, scope);
            if (res.handled)
                return res;
        }
        const generic = this.adapters.get("generic");
        if (generic?.fillFormField) {
            return await generic.fillFormField(page, field, scope);
        }
        return { handled: false, error: "未找到能处理该字段的适配器" };
    }
}
export const adapterRegistry = new UIAdapterRegistryImpl();
//# sourceMappingURL=registry.js.map