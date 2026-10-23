import type { BrowserConfig } from "../types.js";
import type { PolicyDecision, PolicyEvaluationContext, PolicyRule } from "./types.js";
export declare const DEFAULT_SENSITIVE_PATTERNS: string[];
export declare const DEFAULT_SENSITIVE_TOOLS: string[];
export interface SensitiveDesc {
    role?: string;
    name?: string;
    text?: string;
    id?: string;
    testid?: string;
    tag?: string;
}
/**
 * 纯逻辑: 元素描述命中了哪些敏感模式(role/name/text/id/testid/tag 拼接后
 * 子串匹配, 大小写不敏感; 空白模式忽略)。返回命中的模式列表(空 = 放行)。
 */
export declare function sensitiveHits(desc?: SensitiveDesc | null, patterns?: string[]): string[];
/**
 * 判定单条策略规则是否匹配当前上下文
 */
export declare function matchPolicyRule(rule: PolicyRule, ctx: PolicyEvaluationContext): boolean;
/**
 * 策略引擎评估入口: 按规则链顺序判定，优先匹配第一条命中的规则
 */
export declare function evaluatePolicy(config: BrowserConfig, ctx: PolicyEvaluationContext): PolicyDecision;
//# sourceMappingURL=engine.d.ts.map