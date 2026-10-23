import type { Page } from "playwright-core";
export interface ConsoleLogEntry {
    type: string;
    text: string;
    timestamp: number;
    stepId?: string;
}
export interface FailedRequestEntry {
    url: string;
    method: string;
    status?: number;
    error?: string;
    timestamp: number;
    stepId?: string;
}
export interface StepTraceEntry {
    stepId: string;
    stepIndex: number;
    tool: string;
    args?: Record<string, any>;
    url: string;
    startedAt: number;
    durationMs: number;
    success: boolean;
    error?: string;
    consoleLogs: ConsoleLogEntry[];
    failedRequests: FailedRequestEntry[];
    thumbnail?: string;
}
declare class SessionTracer {
    private consoleLogsByProfile;
    private failedRequestsByProfile;
    private tracesByProfile;
    private activeStepByProfile;
    private stepCounter;
    /** 记录 Console 输出 */
    recordConsole(profile: string, entry: ConsoleLogEntry): void;
    /** 记录失败网络请求 (4xx/5xx 或网络断裂) */
    recordFailedRequest(profile: string, entry: FailedRequestEntry): void;
    /** 步骤开始 */
    startStep(profile: string, tool: string, args?: Record<string, any>, page?: Page | null): string;
    /** 步骤结束并归档 */
    endStep(profile: string, success: boolean, error?: string, page?: Page | null): Promise<StepTraceEntry | null>;
    getTraces(profile: string): StepTraceEntry[];
    clear(profile?: string): void;
}
export declare const sessionTracer: SessionTracer;
export {};
//# sourceMappingURL=tracer.d.ts.map