import type { PlainToolDefinition, ToolRunContext } from "./types.js";
/** 注入日志函数(插件 apply 时调用一次)。 */
export declare function setToolsLogger(fn: ((message: string) => void) | null): void;
/**
 * Resolve the workspace working directory for one tool execution.
 * Prefers the calling agent's session cwd; falls back to the host process cwd.
 */
export declare function workspaceCwd(exec: ToolRunContext | undefined): string;
/**
 * 截图/下载/上传等文件的落盘基准目录:
 *   1. config.workspaceDir 显式指定(相对路径按 process.cwd() 解析)——最高优先;
 *   2. 会话 cwd 探测链(workspaceCwd);
 * 首次解析打一次日志,记录来源,便于诊断「文件落错位置」类问题。
 */
export declare function workspaceBaseDir(config: {
    workspaceDir?: string;
}, exec: ToolRunContext | undefined): string;
/** definePlainTool 的输入选项。 */
export interface PlainToolOptions {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    execute: (args: any, exec: ToolRunContext) => Promise<unknown> | unknown;
    render?: (args: any, value: any) => string;
    presentCall?: (args: any) => unknown;
    concurrencySafe?: boolean;
    timeoutMs?: number;
}
/**
 * Build a plain ToolDefinition for `ctx.tools.register` without depending on
 * any @deepseek-ai package (max version-alignment tolerance).
 */
export declare function definePlainTool(options: PlainToolOptions): PlainToolDefinition;
/** Generic card view used by all dsh-browser tools. */
export declare function genericCard(kind: string, title: string, rawInput: string): unknown;
//# sourceMappingURL=tools.d.ts.map