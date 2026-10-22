import type { ReplayStep, SelectorHint } from "../types.js";
/** 已保存的录制脚本:name → 步骤数组。 */
export declare const savedRecordings: Map<string, {
    steps: ReplayStep[];
    savedAt: number;
}>;
/** 一次工具调用的记录(操作轨迹 / 录制 / 回放共用)。 */
export interface TestCall {
    tool: string;
    args: Record<string, any>;
    ok: boolean;
    ms: number;
    ts: number;
    error?: string;
    /** 录制时采集的选择器指纹(回放自愈用;register 包装层异步补齐)。 */
    meta?: {
        hint?: SelectorHint;
        source?: "human";
    };
    /** source: "human" 表示这条来自用户在浏览器中的手动操作(混合录制)。 */
    source?: "human";
}
export declare function isRecording(): boolean;
export declare function startRecording(): void;
export declare function stopRecording(): TestCall[];
/** 最近一次完整录制(start→stop)的 buffer;从未录制过返回 null。 */
export declare function lastRecordingOf(): TestCall[] | null;
/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。返回存入的调用对象(供调用方补 meta)。 */
export declare function recordCall(call: TestCall): TestCall;
/** 操作轨迹(按时间倒序,最新在前)。 */
export declare function testLogOf(): TestCall[];
export declare function clearTestLog(): void;
/** window 上的回传 binding 名(须为合法 JS 标识符)。 */
export declare const HUMAN_BINDING = "__dshBrowserHumanEvent";
/** agent 即将/刚刚执行了 DOM 操作(register 包装层调用);1.5s 内的页内事件视为工具回声。 */
export declare function noteAgentAction(): void;
/** 导出供测试:距上次 agent 操作是否在去重窗口内。 */
export declare function agentActionRecent(now?: number, windowMs?: number): boolean;
/**
 * 页内人工操作事件 → 录制步骤(纯函数,导出供测试)。
 * payload 由 installHumanRecorder 生成:{ kind, selector, value?, testid?, role?, name?, id?, text?, tag? }。
 * 无法映射(缺 selector / 未知 kind / 空输入)返回 null。
 */
export declare function humanEventToStep(payload: unknown): {
    tool: string;
    args: Record<string, any>;
    meta: {
        hint: SelectorHint;
        source: "human";
    };
} | null;
/** binding 回调入站口:仅录制中生效;去重窗口内(agent 工具回声)丢弃。 */
export declare function handleHumanEvent(payload: unknown): void;
/**
 * 页内注入的人工操作监听(addInitScript 序列化;每次导航自动重装)。
 * 监听常驻但 node 侧只在录制中生效,关闭录制等价于"移除"。
 * 只上报可交互元素上的 click 与表单控件的 change,避免逐键噪音。
 * F5 收敛:cssPath 等元素描述来自 walker.ts 单一来源(构建期拼装注入),
 * 不再持有内联副本;payload 字段语义与 v0.3 完全一致。
 */
export declare const installHumanRecorder: (payload: unknown) => void;
//# sourceMappingURL=recorder.d.ts.map