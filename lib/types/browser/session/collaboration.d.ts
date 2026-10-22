export declare function setPauseInstruction(instruction: string): void;
export declare function clearPauseInstruction(): void;
export declare function currentPause(): {
    instruction: string;
    startedAt: number;
} | null;
/** 一次待审批的敏感操作(browser_confirm 等待期间供面板展示与提交决策)。 */
export interface PendingConfirm {
    id: string;
    reason: string;
    tool?: string;
    args?: Record<string, any>;
    startedAt: number;
    decision?: "allowed" | "denied";
}
export declare function setPendingConfirm(entry: PendingConfirm): void;
export declare function getPendingConfirm(): PendingConfirm | null;
export declare function clearPendingConfirm(): void;
/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
export declare function resolveConfirm(id: string, decision: "allowed" | "denied"): boolean;
/** live 工具调用开始(register 包装层调用)。 */
export declare function noteToolStart(): void;
/** live 工具调用结束(成功/失败都算结束)。 */
export declare function noteToolEnd(): void;
/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
export declare function activeToolCalls(): number;
//# sourceMappingURL=collaboration.d.ts.map