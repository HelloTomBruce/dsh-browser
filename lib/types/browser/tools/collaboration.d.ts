import type { Page } from "playwright-core";
import type { BrowserConfig } from "../types.js";
/**
 * 操作预告高亮:agent 即将 click/type/select/press 的元素在页面上琥珀色描边
 * ~1.5 秒。异步不阻塞(fire-and-forget,任何失败静默),不影响操作时序。
 */
export declare function previewHighlight(page: Page | null, selector: string, label: string): void;
/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
 * successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
 * 超时返回 loggedIn:false(不抛错)。
 */
export declare function waitForLoginTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    loggedIn: boolean;
}>;
/**
 * 人工接管等待(通用版 wait_for_login):agent 把控制权交还给用户(验证码 /
 * 二次确认 / 人工复核等)。instruction 会显示在实时画面面板;完成条件三选一:
 * successSelector(元素出现)/ successUrl(URL 正则)/ 两者都不给则以
 * URL 变化或页面内容签名变化视为完成。轮询间隔 2 秒,超时返回 completed:false
 * (不抛错)。导出 runPauseOnPage 供测试注入 fake page。
 */
export declare function runPauseOnPage(page: Page, args: Record<string, any>): Promise<{
    completed: boolean;
    waitedMs: number;
    detail: string;
}>;
/** 人工接管等待工具入口(缺 instruction 在启动浏览器前即校验,失败更快)。 */
export declare function pauseForHumanTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    completed: boolean;
    status: "completed" | "timedOut";
    instruction: string;
    detail: string;
    waitedMs: number;
}>;
/**
 * 敏感操作审批:agent 在执行提交/删除/支付类动作前调用,把审批请求推到实时
 * 画面面板,挂起等待用户点「允许/拒绝」。超时视为拒绝(fail-closed)。
 * 用户允许时返回 { decision: "allowed", ... };拒绝/超时**抛错**(消息含原因),
 * 使 live 调用与 replay/batch 步骤统一按失败处理,agent 不应继续敏感动作。
 * 决策通过 session.resolveConfirm(面板 POST)写入。
 */
export declare function confirmTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    decision: "allowed";
    id: string;
    reason: string;
    waitedMs: number;
    detail: string;
}>;
/** auto 模式默认敏感文本模式(提交/删除/支付类)。 */
export declare const DEFAULT_SENSITIVE_PATTERNS: string[];
/** auto 模式默认参与判定的工具(已决:只拦 browser_click,type 误报率高)。 */
export declare const DEFAULT_SENSITIVE_TOOLS: string[];
/** 敏感判定的元素描述(与 walker describeElement 字段子集对应)。 */
export interface SensitiveDesc {
    role: string;
    name: string;
    text: string;
    id: string;
    testid: string;
    tag: string;
}
/**
 * 纯逻辑:元素描述命中了哪些敏感模式(role/name/text/id/testid/tag 拼接后
 * 子串匹配,大小写不敏感;空白模式忽略)。返回命中的模式列表(空 = 放行)。
 * 导出供测试。
 */
export declare function sensitiveHits(desc: SensitiveDesc | null, patterns: string[]): string[];
/**
 * auto 模式审批闸:命中敏感模式时经 confirmTool 弹审批等待用户决策,
 * 拒绝/超时抛错(调用方该步失败),允许则返回继续执行原工具。
 * 不满足前置条件(非 auto / 工具不在 sensitiveTools / 无模式 / 无活动页 /
 * 无目标 selector / 页内取描述失败)一律直接放行,由原工具自行处理错误。
 * page 参数仅供测试注入;缺省取当前活动页。
 */
export declare function confirmGate(config: BrowserConfig, tool: string, args: Record<string, any>, page?: Page | null): Promise<void>;
//# sourceMappingURL=collaboration.d.ts.map