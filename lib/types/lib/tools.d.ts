import type { PlainToolDefinition, ToolRunContext } from "./types.js";
/**
 * Resolve the workspace working directory for one tool execution.
 * Prefers the calling agent's session cwd; falls back to the host process cwd.
 */
export declare function workspaceCwd(exec: ToolRunContext | undefined): string;
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