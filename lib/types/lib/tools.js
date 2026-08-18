// dsh-browser shared helpers: workspace cwd resolution and plain tool definitions.
/**
 * Resolve the workspace working directory for one tool execution.
 * Prefers the calling agent's session cwd; falls back to the host process cwd.
 */
export function workspaceCwd(exec) {
    try {
        const cwd = exec?.agent?.session?.meta?.cwd;
        if (typeof cwd === "string" && cwd.length > 0)
            return cwd;
    }
    catch {
        /* fall through */
    }
    return process.cwd();
}
/**
 * Build a plain ToolDefinition for `ctx.tools.register` without depending on
 * any @deepseek-ai package (max version-alignment tolerance).
 */
export function definePlainTool(options) {
    const render = options.render ?? ((_args, value) => JSON.stringify(value, null, 2));
    const definition = {
        name: options.name,
        description: options.description,
        parameters: options.parameters,
        output: {
            // 默认 schema 保持宽松:显式声明 outputSchema 的工具才会被严格校验。
            schema: options.outputSchema ?? {
                type: "object",
            },
            render: (args, value) => [{ type: "text", text: render(args, value) }],
        },
        execute: options.execute,
    };
    if (options.presentCall !== undefined)
        definition.presentCall = options.presentCall;
    if (options.concurrencySafe)
        definition.isConcurrencySafe = () => true;
    if (options.timeoutMs !== undefined)
        definition.timeoutMs = options.timeoutMs;
    return definition;
}
/** Generic card view used by all dsh-browser tools. */
export function genericCard(kind, title, rawInput) {
    return { card: "generic", kind, title, rawInput };
}
//# sourceMappingURL=tools.js.map