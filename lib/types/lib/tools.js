// dsh-browser shared helpers: workspace cwd resolution and plain tool definitions.
import { isAbsolute, resolve } from "node:path";
/** 可选的诊断日志(由 registerTools 注入 ctx.logger;未注入时静默)。 */
let logFn = null;
let cwdLogged = false;
/** 注入日志函数(插件 apply 时调用一次)。 */
export function setToolsLogger(fn) {
    logFn = fn;
}
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
    try {
        const cwd = exec?.cwd;
        if (typeof cwd === "string" && cwd.length > 0)
            return cwd;
    }
    catch {
        /* fall through */
    }
    return process.cwd();
}
/**
 * 截图/下载/上传等文件的落盘基准目录:
 *   1. config.workspaceDir 显式指定(相对路径按 process.cwd() 解析)——最高优先;
 *   2. 会话 cwd 探测链(workspaceCwd);
 * 首次解析打一次日志,记录来源,便于诊断「文件落错位置」类问题。
 */
export function workspaceBaseDir(config, exec) {
    const explicit = config.workspaceDir;
    if (typeof explicit === "string" && explicit.length > 0) {
        const dir = isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
        if (!cwdLogged) {
            cwdLogged = true;
            logFn?.(`dsh-browser: 工作目录基准 = ${dir} (来源: config.workspaceDir)`);
        }
        return dir;
    }
    const dir = workspaceCwd(exec);
    if (!cwdLogged) {
        cwdLogged = true;
        const fromSession = (() => {
            try {
                return typeof exec?.agent?.session?.meta?.cwd === "string" && exec.agent.session.meta.cwd.length > 0;
            }
            catch {
                return false;
            }
        })();
        logFn?.(`dsh-browser: 工作目录基准 = ${dir} (来源: ${fromSession ? "session.meta.cwd" : "process.cwd"})`);
    }
    return dir;
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