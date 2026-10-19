/** 一步的执行结果(与 runReplay results 条目同形,外加自愈标记)。 */
export interface RunStepResult {
    index: number;
    tool: string;
    ok: boolean;
    error?: string;
    healed?: boolean;
    via?: string;
    resolved?: string;
}
/** 一次 replay/batch 的运行记录。 */
export interface RunRecord {
    runId: string;
    ts: number;
    kind: "replay" | "batch";
    source: string;
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    durationMs: number;
    /** data 数据集模式时的行号(单次运行为 undefined)。 */
    row?: number;
    results: RunStepResult[];
}
/** 报告存储目录($DSH_HOME/.dsh-browser/reports)。 */
export declare function reportsDir(): string;
/** 生成 runId:YYYYMMDD-HHmmss-随机4位。 */
export declare function makeRunId(ts: number): string;
/** 追加一条运行记录;超限时截断旧行(原子替换)。 */
export declare function appendRun(record: RunRecord): void;
/** 读取全部运行记录(按时间倒序);坏行静默跳过。 */
export declare function listRuns(limit?: number): RunRecord[];
/** 最近一次运行(无记录返回 null)。 */
export declare function latestRun(): RunRecord | null;
/** 按 runId 取单条记录。 */
export declare function getRun(runId: string): RunRecord | null;
/** 生成 Markdown 回归报告。 */
export declare function renderMarkdownReport(runs: RunRecord[], source?: string): string;
/** 生成自包含 HTML 回归报告(内联样式,无外部资源)。 */
export declare function renderHtmlReport(runs: RunRecord[], source?: string): string;
//# sourceMappingURL=reports.d.ts.map