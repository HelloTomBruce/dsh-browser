export interface PolicyRule {
    /** 规则名称/标识 */
    name: string;
    /** 页面 URL 正则模式，如 ".*(localhost|127\\.0\\.0\\.1|\\.test\\.|\\.qa\\.).*" */
    urlPattern?: string;
    /** 动作/工具正则模式，如 "browser_click", "browser_.*" */
    actionPattern?: string;
    /** 选择器正则模式，如 "#danger-action.*" */
    selectorPattern?: string;
    /** 敏感文本模式数组，如 ["提交", "删除", "支付"] */
    patterns?: string[];
    /** 拦截级别：off(直接放行) | manual(提示) | auto(强制审批弹卡) */
    level: "off" | "manual" | "auto";
    /** 审批超时时间 (毫秒)，覆盖全局 confirmTimeoutMs */
    timeoutMs?: number;
}
export interface PolicyEvaluationContext {
    url: string;
    tool: string;
    selector: string;
    desc?: {
        role?: string;
        name?: string;
        text?: string;
        id?: string;
        testid?: string;
        tag?: string;
    } | null;
}
export interface PolicyDecision {
    matchedRule?: PolicyRule;
    level: "off" | "manual" | "auto";
    reason?: string;
    timeoutMs?: number;
}
//# sourceMappingURL=types.d.ts.map