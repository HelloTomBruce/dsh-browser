import { definePlainTool } from "../../lib/tools.js";
import { snapshotTool, findTool, elementsTool, screenshotTool } from "../tools.js";
export function getInspectionTools(config, timeout, stepImpls) {
    return [
        definePlainTool({
            name: "browser_snapshot",
            description: "读取当前页面快照(不截图)。mode:'text'(默认)返回压缩后的可见文本+链接清单,适合读内容;'aria' 返回可访问性树,可交互元素带 [ref=eN] 短引用,后续 browser_click/browser_type/browser_select/browser_press 可直接传 ref 代替 CSS 选择器(导航或重新快照后旧 ref 失效)。maxTextChars 默认 20000。scope:可选 CSS 选择器,只对命中的容器区域提取(text/aria 两种模式都生效,scope 未命中报错)。since:增量模式,传之前任一次快照返回的 contentVersion——历史版本环形缓存(snapshotHistory 默认 5,可配 1-20)窗口内的任意版本都能 diff:内容未变返回 { unchanged: true },变了只返回相对该版本的变化行(diff: true, changedFrom/removed 标注变化区),表格翻页/局部刷新/轮询抓取后重读 token 开销可降一个量级;since 超出窗口(过旧/未知)则回落全量并标 stale。",
            parameters: {
                type: "object",
                properties: {
                    mode: { type: "string", enum: ["text", "aria"], description: "快照模式,默认 text。" },
                    scope: { type: "string", description: "可选:限定提取区域的 CSS 选择器(如 '#main')。" },
                    since: { type: "integer", description: "可选:之前任一次快照的 contentVersion(历史窗口内任意版本),只返回相对该版本的变化内容。" },
                    maxTextChars: { type: "integer", description: "文本截断上限。" },
                    maxLinks: { type: "integer", description: "链接数量上限(text 模式)。" },
                    maxRefs: { type: "integer", description: "ref 分配上限(aria 模式,默认 200)。" },
                    viewportOnly: { type: "boolean", description: "仅提取当前视口内可见元素(几何相交剪枝),大幅节省 Token。" },
                    viewportPadding: { type: "integer", description: "视口外边缘扩展预加载边距(像素)。" },
                },
                additionalProperties: false,
            },
            outputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    url: { type: "string" },
                    title: { type: "string" },
                    text: { type: "string" },
                    tree: { type: "string" },
                    truncated: { type: "boolean" },
                    links: { type: "array", items: { type: "object" } },
                    inputs: { type: "integer" },
                    refs: { type: "integer" },
                    scope: { type: "string" },
                    contentVersion: { type: "integer" },
                    unchanged: { type: "boolean" },
                    diff: { type: "boolean" },
                    changedFrom: { type: "integer" },
                    removed: { type: "integer" },
                    stale: { type: "boolean" },
                    viewportOnly: { type: "boolean" },
                    prunedCount: { type: "integer" },
                },
                required: ["url", "title", "truncated"],
            },
            render: (_args, value) => {
                if (value.unchanged === true) {
                    return `页面未变化(版本 v${value.contentVersion}): ${value.url}`;
                }
                if (value.diff === true) {
                    const body = value.tree !== undefined ? value.tree : value.text;
                    return `内容变化(v${value.contentVersion},第 ${value.changedFrom} 行起,删除 ${value.removed} 行):\n${body}`;
                }
                if (value.tree !== undefined) {
                    return `URL: ${value.url}\nTitle: ${value.title}\nRefs: ${value.refs}\nVersion: v${value.contentVersion}${value.stale === true ? "(stale)" : ""}\n--- aria tree ---\n${value.tree}`;
                }
                return `URL: ${value.url}\nTitle: ${value.title}\nInputs: ${value.inputs}\nVersion: v${value.contentVersion}${value.stale === true ? "(stale)" : ""}\n--- text ---\n${value.text}`;
            },
            timeoutMs: timeout(),
            execute: (args) => snapshotTool(config, args),
        }),
        definePlainTool({
            name: "browser_find",
            description: "按名称/id/data-testid 语义定位页面元素,只返回命中的 ref + 区域上下文,不输出全量 aria 树 —— 在大页面定位单个操作目标时比 browser_snapshot { mode: \"aria\" } 省 95% 以上 token。返回的 ref 可直接传给 browser_click / browser_type / browser_select / browser_press。默认包含匹配(query 是名称子串,忽略大小写;exact:true 精确匹配);scope 限定查找容器;多命中全部返回并附 ancestors 区域链供二次定位;零命中不抛错,返回最相近的 suggestions 候选。",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "要找的元素名称(如「提交」「登录」),或元素 id / data-testid。" },
                    exact: { type: "boolean", description: "true 时名称需完全相等(默认 false 包含匹配)。" },
                    scope: { type: "string", description: "可选:限定查找的容器 CSS 选择器(如 '#login-form')。" },
                },
                required: ["query"],
                additionalProperties: false,
            },
            outputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    found: { type: "integer" },
                    matches: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                ref: { type: "string" },
                                role: { type: "string" },
                                name: { type: "string" },
                                ancestors: { type: "array", items: { type: "string" } },
                            },
                            required: ["ref", "role", "name", "ancestors"],
                            additionalProperties: false,
                        },
                    },
                    suggestions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { role: { type: "string" }, name: { type: "string" }, score: { type: "integer" } },
                            required: ["role", "name", "score"],
                            additionalProperties: false,
                        },
                    },
                    truncated: { type: "boolean" },
                    scanned: { type: "integer" },
                    url: { type: "string" },
                    title: { type: "string" },
                },
                required: ["found", "matches", "scanned", "url", "title"],
            },
            render: (args, value) => {
                const hits = value.matches.map((m) => `${m.ref}=${m.role} "${m.name}"`).join(", ");
                if (value.found > 0) {
                    return `找到 ${value.found} 个「${args.query}」: ${hits}${value.found > 10 ? " …" : ""}`;
                }
                const sugg = (value.suggestions ?? []).map((s) => `${s.role} "${s.name}"`).join("、");
                return `未找到「${args.query}」(扫描 ${value.scanned} 个元素)${sugg ? `;相近候选: ${sugg}` : ""}`;
            },
            timeoutMs: timeout(),
            execute: (args) => findTool(config, args),
        }),
        definePlainTool({
            name: "browser_elements",
            description: "列出当前页面可交互元素(input/textarea/select/button/链接)的结构化清单:类型、name/id、关联 label(aria-label/label[for]/form-item)、placeholder、可见文本、可直接用于 browser_click/browser_type/browser_select 的 CSS 选择器。页面有展开的下拉时,dropdownOptions 会列出可见选项。比 browser_snapshot 更适合定位表单。",
            parameters: {
                type: "object",
                properties: {
                    max: { type: "integer", description: "最多返回多少元素,默认 60。" },
                },
                additionalProperties: false,
            },
            outputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    count: { type: "integer" },
                    elements: { type: "array", items: { type: "object" } },
                    dropdownOptions: { type: "array", items: { type: "string" } },
                },
                required: ["count", "elements", "dropdownOptions"],
            },
            render: (_args, value) => {
                const lines = (value.elements ?? []).map((e) => `<${e.tag}${e.type ? ` type=${e.type}` : ""}>${e.name ? ` name=${e.name}` : ""}${e.id ? ` id=${e.id}` : ""}${e.label ? ` label="${e.label}"` : ""}${e.placeholder ? ` ph="${e.placeholder}"` : ""}${e.text ? ` "${e.text.slice(0, 40)}"` : ""}${e.selector ? ` → ${e.selector}` : ""}`);
                if ((value.dropdownOptions ?? []).length > 0) {
                    lines.push(`--- 展开的下拉选项 ---`, ...value.dropdownOptions.map((o) => `  ${o}`));
                }
                return lines.join("\n") || "(no interactive elements)";
            },
            timeoutMs: timeout(),
            execute: (args) => elementsTool(config, args),
        }),
        definePlainTool({
            name: "browser_screenshot",
            description: "把当前页面截图保存为 PNG 文件(默认存到工作区 .dsh-browser/screenshots/),返回文件路径。传 baseline=<名字> 时存为视觉回归基线(.dsh-browser/baselines/,不受清理策略约束),供 browser_assert 的 visual 断言比对。纯文本模型看不到图,但用户可以在实时画面面板查看。",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "文件名(不含扩展名也会自动补 .png)。" },
                    baseline: { type: "string", description: "存为视觉回归基线(基线名)。" },
                    som: { type: "boolean", description: "启用 Set-of-Marks 视口标徽, 在可交互元素上绘制数字徽章。" },
                    somColor: { type: "string", enum: ["red", "blue", "green"], description: "标徽主题色(默认 red)。" },
                    maxMarks: { type: "integer", description: "标徽数量上限, 默认 50。" },
                },
                additionalProperties: false,
            },
            outputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    path: { type: "string" },
                    bytes: { type: "integer" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                    baseline: { type: "string" },
                    som: { type: "boolean" },
                    somMarks: { type: "array", items: { type: "object" } },
                },
                required: ["path", "bytes", "width", "height"],
            },
            render: (args, value) => `Saved ${value.bytes} bytes → ${value.path}`,
            timeoutMs: timeout(),
            execute: (args, exec) => screenshotTool(config, args, exec),
        })
    ];
}
//# sourceMappingURL=inspection.js.map