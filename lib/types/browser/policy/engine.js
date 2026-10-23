export const DEFAULT_SENSITIVE_PATTERNS = ["提交", "删除", "支付"];
export const DEFAULT_SENSITIVE_TOOLS = ["browser_click"];
/**
 * 纯逻辑: 元素描述命中了哪些敏感模式(role/name/text/id/testid/tag 拼接后
 * 子串匹配, 大小写不敏感; 空白模式忽略)。返回命中的模式列表(空 = 放行)。
 */
export function sensitiveHits(desc, patterns) {
    if (!desc || !patterns || patterns.length === 0)
        return [];
    const hay = [desc.role, desc.name, desc.text, desc.id, desc.testid, desc.tag]
        .filter((s) => typeof s === "string")
        .join(" ")
        .toLowerCase();
    if (hay === "")
        return [];
    return patterns.filter((p) => typeof p === "string" && p.trim() !== "" && hay.includes(p.trim().toLowerCase()));
}
function safeRegexMatch(pattern, value) {
    if (!pattern)
        return true;
    try {
        const re = new RegExp(pattern, "i");
        return re.test(value);
    }
    catch {
        return value.includes(pattern);
    }
}
/**
 * 判定单条策略规则是否匹配当前上下文
 */
export function matchPolicyRule(rule, ctx) {
    // 1. URL 模式匹配
    if (rule.urlPattern && !safeRegexMatch(rule.urlPattern, ctx.url)) {
        return false;
    }
    // 2. 动作/工具匹配
    if (rule.actionPattern && !safeRegexMatch(rule.actionPattern, ctx.tool)) {
        return false;
    }
    // 3. 选择器匹配
    if (rule.selectorPattern && !safeRegexMatch(rule.selectorPattern, ctx.selector)) {
        return false;
    }
    // 4. 敏感关键词匹配
    if (rule.patterns && rule.patterns.length > 0) {
        const hits = sensitiveHits(ctx.desc, rule.patterns);
        if (hits.length === 0) {
            return false;
        }
    }
    return true;
}
/**
 * 策略引擎评估入口: 按规则链顺序判定，优先匹配第一条命中的规则
 */
export function evaluatePolicy(config, ctx) {
    const policies = config.confirmPolicies;
    if (Array.isArray(policies) && policies.length > 0) {
        for (const rule of policies) {
            if (matchPolicyRule(rule, ctx)) {
                const hits = rule.patterns ? sensitiveHits(ctx.desc, rule.patterns) : [];
                const hitInfo = hits.length > 0 ? ` 命中文本 [${hits.join(", ")}]` : "";
                return {
                    matchedRule: rule,
                    level: rule.level,
                    timeoutMs: rule.timeoutMs,
                    reason: `策略规则 [${rule.name}] 命中: 动作 ${ctx.tool}${hitInfo}`.trim(),
                };
            }
        }
        // 未命中任何规则，默认放行
        return { level: "off" };
    }
    // 向后兼容传统 confirmMode: "auto" / "manual" / "off"
    const mode = config.confirmMode ?? "off";
    if (mode === "auto") {
        const sensitiveTools = config.sensitiveTools ?? DEFAULT_SENSITIVE_TOOLS;
        if (sensitiveTools.includes(ctx.tool)) {
            const patterns = config.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;
            const hits = sensitiveHits(ctx.desc, patterns);
            if (hits.length > 0) {
                return {
                    level: "auto",
                    timeoutMs: config.confirmTimeoutMs,
                    reason: `confirmMode:auto 硬拦截:${ctx.tool} 目标元素命中敏感模式 [${hits.join(", ")}]`,
                };
            }
        }
        return { level: "off" };
    }
    return { level: mode };
}
//# sourceMappingURL=engine.js.map