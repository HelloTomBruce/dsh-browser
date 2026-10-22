import type { BrowserOp, BrowserStatus, LatestRun, NavHistoryItem, PendingConfirm, RecordingDetail, RecordingRow } from "./types.js";
/** 获取插件后端 API 基路径 (默认为 /browser) */
export declare function getBasePath(): Promise<string>;
export declare function fetchStatus(base: string): Promise<BrowserStatus | null>;
export declare function fetchHistory(base: string): Promise<NavHistoryItem[]>;
export declare function fetchOperations(base: string): Promise<BrowserOp[]>;
export declare function fetchLatestRun(base: string): Promise<{
    run: LatestRun | null;
    busy: boolean;
}>;
export declare function fetchPendingConfirm(base: string): Promise<PendingConfirm | null>;
export declare function submitConfirmDecision(base: string, id: string, decision: "allowed" | "denied"): Promise<boolean>;
export declare function triggerRerun(base: string, source: string, retryOf?: string): Promise<{
    ok: boolean;
    status?: number;
    error?: string;
}>;
export declare function fetchRecordings(base: string): Promise<RecordingRow[]>;
export declare function fetchRecordingDetail(base: string, name: string): Promise<RecordingDetail | null>;
export declare function deleteRecordingApi(base: string, name: string): Promise<boolean>;
//# sourceMappingURL=api.d.ts.map