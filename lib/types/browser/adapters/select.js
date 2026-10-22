// dsh-browser · 组件库下拉选择适配门面 (Select Adapter Facade)
// 将不同 UI 组件库(Ant Design, Element Plus, 原生 Select, 通用 ARIA)的特异性展开与选项定位逻辑
// 彻底隔离在独立适配器插件中，本文件作为统一调度门面保证向后兼容。
import { adapterRegistry } from "./registry.js";
/**
 * 调度器入口: 自动委托给 adapterRegistry 解析最合适的 UI 适配器执行交互。
 */
export async function executeSelectAdapter(ctx) {
    return adapterRegistry.executeSelect(ctx);
}
//# sourceMappingURL=select.js.map