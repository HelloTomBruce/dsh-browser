import { definePlainTool, genericCard, setToolsLogger } from "../lib/tools.js";
import { recordCall, isRecording, activePage, noteAgentAction, pageRef } from "./session.js";
import { openTool, snapshotTool, clickTool, typeTool, pressTool, selectTool, evalTool, screenshotTool, waitTool, backTool, reloadTool, statusTool, closeTool, tabsTool, downloadTool, uploadTool, cookiesTool, formTool, formSaveTool, formsTool, profileTool, elementsTool, waitForLoginTool, pauseForHumanTool, confirmTool, findTool, waitForTool, assertTool, networkTool, recordTool, replayTool, batchTool, extractTool, reportTool, captureSelectorHint, SELECTOR_STEP_TOOLS, doctorTool, contextTool, previewHighlight, } from "./tools.js";
export function registerTools(ctx, config) {
    const tools = ctx.get("tools");
    if (tools === undefined)
        return;
    setToolsLogger((m) => ctx.logger?.info?.(m));
    const timeout = (ms) => ms ?? config.timeoutMs;
    /**
     * 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。
     * 注意:记录必须保留完整原始 args —— 录制/回放依赖脚本、steps 数组等大字段的
     * 完整性(截断会让回放得到损坏的 script / 空的 steps)。展示层截断在 ui.ts 做。
     */
    /** 会触发真实 DOM 事件的 agent 工具:执行前后打点,混合录制时用于区分人手与工具回声。 */
    const AGENT_DOM_TOOLS = new Set([
        "browser_click", "browser_type", "browser_select", "browser_press",
        "browser_upload", "browser_form", "browser_eval",
    ]);
    /** 操作预告:这些工具执行前把目标元素在实时画面上高亮(异步不阻塞)。 */
    const PREVIEW_TOOLS = new Set(["browser_click", "browser_type", "browser_select", "browser_press"]);
    /**
     * toolset: "core" 的高频核心集:浏览/定位/操作/等待/断言/人机协作。
     * 低频的录制/回放/报告/抽取/表单回放/profile/context 等只在 "all" 注册。
     */
    const CORE_TOOLS = new Set([
        "browser_open", "browser_snapshot", "browser_find", "browser_elements",
        "browser_click", "browser_type", "browser_press", "browser_select",
        "browser_eval", "browser_batch", "browser_wait", "browser_wait_for",
        "browser_assert", "browser_screenshot", "browser_wait_for_login",
        "browser_pause_for_human", "browser_confirm", "browser_network",
        "browser_tabs", "browser_download", "browser_upload", "browser_status",
        "browser_doctor", "browser_close",
    ]);
    /** 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。 */
    function register(def) {
        // core 模式:低频工具不注册(不进 systemPrompt,按需把 toolset 改回 all)。
        if (config.toolset === "core" && !CORE_TOOLS.has(def.name))
            return;
        const original = def.execute;
        def.execute = async (args, exec) => {
            const t0 = Date.now();
            const domTool = AGENT_DOM_TOOLS.has(def.name);
            if (domTool)
                noteAgentAction(); // 去重窗口起点:即将产生页内事件
            if (PREVIEW_TOOLS.has(def.name)) {
                // 目标 selector:直传 selector,或 ref 解析出注册表里的 CSS 路径
                const page = activePage();
                const sel = typeof args?.selector === "string" && args.selector
                    ? args.selector
                    : typeof args?.ref === "string" && args.ref && page !== null
                        ? (pageRef(page, args.ref)?.selector ?? "")
                        : "";
                previewHighlight(page, sel, def.name.replace("browser_", ""));
            }
            try {
                const value = await original(args, exec);
                if (domTool)
                    noteAgentAction(); // 事件可能在 await 期间/之后才派发
                const call = recordCall({ tool: def.name, args, ok: true, ms: Date.now() - t0, ts: Date.now() });
                // 录制中且步骤使用 selector:采集选择器指纹,供回放自愈(formatVersion 2)。
                if (isRecording() && SELECTOR_STEP_TOOLS.has(def.name) && typeof args?.selector === "string") {
                    const page = activePage();
                    if (page !== null) {
                        const hintResult = await captureSelectorHint(page, String(args.selector));
                        if (hintResult !== null)
                            call.meta = { hint: hintResult };
                    }
                }
                return value;
            }
            catch (error) {
                recordCall({
                    tool: def.name,
                    args,
                    ok: false,
                    ms: Date.now() - t0,
                    ts: Date.now(),
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        };
        tools.register(def);
    }
    /** 回放步骤 → 工具实现映射(config 闭包)。 */
    const stepImpls = {
        browser_open: (a) => openTool(config, a),
        browser_snapshot: (a) => snapshotTool(config, a),
        browser_click: (a) => clickTool(config, a),
        browser_type: (a) => typeTool(config, a),
        browser_press: (a) => pressTool(config, a),
        browser_select: (a) => selectTool(config, a),
        browser_eval: (a) => evalTool(config, a),
        browser_screenshot: (a) => screenshotTool(config, a),
        browser_wait: (a) => waitTool(config, a),
        browser_back: () => backTool(config),
        browser_reload: () => reloadTool(config),
        browser_status: () => statusTool(),
        browser_close: () => closeTool(),
        browser_tabs: (a) => tabsTool(config, a),
        browser_download: (a) => downloadTool(config, a),
        browser_upload: (a) => uploadTool(config, a),
        browser_cookies: (a) => cookiesTool(config, a),
        browser_form: (a) => formTool(config, a),
        browser_form_save: (a) => formSaveTool(a),
        browser_forms: (a) => formsTool(a),
        browser_profile: (a) => profileTool(config, a),
        browser_elements: (a) => elementsTool(config, a),
        browser_wait_for_login: (a) => waitForLoginTool(config, a),
        browser_pause_for_human: (a) => pauseForHumanTool(config, a),
        browser_confirm: (a) => confirmTool(config, a),
        browser_find: (a) => findTool(config, a),
        browser_doctor: (a) => doctorTool(config, a, undefined),
        browser_context: (a) => contextTool(config, a),
        browser_wait_for: (a) => waitForTool(config, a),
        browser_assert: (a) => assertTool(config, a, undefined),
        browser_network: (a) => networkTool(a),
        browser_record: (a) => recordTool(a),
        browser_replay: (a) => replayTool(a, stepImpls, config),
        browser_batch: (a) => batchTool(a, stepImpls, config),
        browser_extract: (a) => extractTool(config, a),
    };
    register(definePlainTool({
        name: "browser_open",
        description: "在共享浏览器中打开一个 URL。之后可用 browser_snapshot 读取页面内容,用 browser_click / browser_type / browser_eval 操作页面,用 browser_screenshot 截图。",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "要打开的完整 URL(含协议)。" },
                waitUntil: {
                    type: "string",
                    enum: ["load", "domcontentloaded", "commit"],
                    description: "等待策略,默认 domcontentloaded。",
                },
                timeoutMs: { type: "integer", description: "等待超时(毫秒)。" },
            },
            required: ["url"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                url: { type: "string" },
                title: { type: "string" },
                status: { type: "string" },
            },
            required: ["url", "title", "status"],
        },
        render: (_args, value) => `Opened ${value.url}\nTitle: ${value.title}`,
        presentCall: (args) => genericCard("browser", String(args.url), String(args.url)),
        timeoutMs: timeout(),
        execute: (args) => openTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_snapshot",
        description: "读取当前页面快照(不截图)。mode:'text'(默认)返回压缩后的可见文本+链接清单,适合读内容;'aria' 返回可访问性树,可交互元素带 [ref=eN] 短引用,后续 browser_click/browser_type/browser_select/browser_press 可直接传 ref 代替 CSS 选择器(导航或重新快照后旧 ref 失效)。maxTextChars 默认 20000。scope:可选 CSS 选择器,只对命中的容器区域提取(text/aria 两种模式都生效,scope 未命中报错)。since:增量模式,传上次快照返回的 contentVersion——内容未变返回 { unchanged: true },变了只返回变化的行(diff: true, changedFrom/removed 标注变化区),表格翻页/局部刷新后重读 token 开销可降一个量级;since 过期则回落全量并标 stale。",
        parameters: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["text", "aria"], description: "快照模式,默认 text。" },
                scope: { type: "string", description: "可选:限定提取区域的 CSS 选择器(如 '#main')。" },
                since: { type: "integer", description: "可选:上次快照的 contentVersion,只返回变化内容。" },
                maxTextChars: { type: "integer", description: "文本截断上限。" },
                maxLinks: { type: "integer", description: "链接数量上限(text 模式)。" },
                maxRefs: { type: "integer", description: "ref 分配上限(aria 模式,默认 200)。" },
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
    }));
    register(definePlainTool({
        name: "browser_click",
        description: "点击页面元素:selector(CSS)或 ref(来自 browser_snapshot mode:'aria')二选一。",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS 选择器。" },
                ref: { type: "string", description: "aria 快照的 ref(如 'e3');导航后失效。" },
                timeoutMs: { type: "integer" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                clicked: { type: "string" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["clicked", "url", "title"],
        },
        render: (_args, value) => `Clicked ${value.clicked}\nNow at: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args) => clickTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_type",
        description: "向输入框输入文本:selector(CSS)或 ref 二选一。clear=true 时先清空再输入(推荐用于表单);submit=true 时输入后按回车。",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string" },
                ref: { type: "string", description: "aria 快照的 ref(如 'e2')。" },
                text: { type: "string" },
                clear: { type: "boolean" },
                submit: { type: "boolean" },
                delayMs: { type: "integer" },
                timeoutMs: { type: "integer" },
            },
            required: ["text"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                typed: { type: "boolean" },
                selector: { type: "string" },
                submit: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["typed", "selector", "submit", "url", "title"],
        },
        render: (_args, value) => `Typed into ${value.selector}${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args) => typeTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_press",
        description: "按键:有 selector 或 ref 时先聚焦该元素再按键(如 'Enter'、'Tab'、'Escape'、'Control+a'),否则在页面级按键。",
        parameters: {
            type: "object",
            properties: {
                key: { type: "string", description: "按键名(Playwright 键盘键名)。" },
                selector: { type: "string" },
                ref: { type: "string", description: "aria 快照的 ref。" },
                timeoutMs: { type: "integer" },
            },
            required: ["key"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                pressed: { type: "string" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["pressed", "url", "title"],
        },
        render: (_args, value) => `Pressed ${value.pressed}`,
        timeoutMs: timeout(),
        execute: (args) => pressTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_select",
        description: "下拉选择原语:原生 <select> 与组件库下拉(antd / element-plus / ARIA listbox)通用。selector 或 ref 指向下拉触发框,option 为选项文本(默认包含匹配,exact=true 精确)。找不到选项时报错并列出可见选项,无需再 browser_eval 探查。",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "下拉触发框的 CSS 选择器(如 #rc_select_1)。" },
                ref: { type: "string", description: "aria 快照的 ref。" },
                option: { type: "string", description: "要选择的选项文本。" },
                exact: { type: "boolean", description: "精确匹配,默认 false(包含匹配)。" },
                timeoutMs: { type: "integer" },
            },
            required: ["option"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                selected: { type: "string" },
                selector: { type: "string" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["selected", "selector", "url", "title"],
        },
        render: (_args, value) => `Selected "${value.selected}" in ${value.selector}`,
        timeoutMs: timeout(),
        execute: (args) => selectTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_eval",
        description: "在页面上下文执行一段 JavaScript。表达式直接求值(如 'document.title');含换行/分号的语句会被包进 async IIFE,可用 return 返回。结果必须是可 JSON 序列化的值。",
        parameters: {
            type: "object",
            properties: {
                script: { type: "string", description: "要执行的 JavaScript。" },
            },
            required: ["script"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                result: {},
                scriptUnwrapped: { type: "boolean", description: "入参 script 疑似被 JSON 双重序列化(以引号包裹且含 \\n 字面量),已自动解码一层。" },
            },
            required: ["result"],
        },
        render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
        timeoutMs: timeout(),
        execute: (args) => evalTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_screenshot",
        description: "把当前页面截图保存为 PNG 文件(默认存到工作区 .dsh-browser/screenshots/),返回文件路径。传 baseline=<名字> 时存为视觉回归基线(.dsh-browser/baselines/,不受清理策略约束),供 browser_assert 的 visual 断言比对。纯文本模型看不到图,但用户可以在实时画面面板查看。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "文件名(不含扩展名也会自动补 .png)。" },
                baseline: { type: "string", description: "存为视觉回归基线(基线名)。" },
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
            },
            required: ["path", "bytes", "width", "height"],
        },
        render: (args, value) => `Saved ${value.bytes} bytes → ${value.path}`,
        timeoutMs: timeout(),
        execute: (args, exec) => screenshotTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_wait",
        description: "等待指定毫秒数(上限 60000),常用于等待页面渲染或请求完成。",
        parameters: {
            type: "object",
            properties: {
                ms: { type: "integer", description: "等待毫秒数,默认 1000。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                waitedMs: { type: "integer" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["waitedMs", "url", "title"],
        },
        render: (_args, value) => `Waited ${value.waitedMs}ms`,
        timeoutMs: timeout(),
        execute: (args) => waitTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_back",
        description: "返回上一页(如无历史则无操作)。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { url: { type: "string" }, title: { type: "string" } },
            required: ["url", "title"],
        },
        render: (_args, value) => `Back to: ${value.url}`,
        timeoutMs: timeout(),
        execute: () => backTool(config),
    }));
    register(definePlainTool({
        name: "browser_reload",
        description: "重新加载当前页面。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { url: { type: "string" }, title: { type: "string" } },
            required: ["url", "title"],
        },
        render: (_args, value) => `Reloaded: ${value.url}`,
        timeoutMs: timeout(),
        execute: () => reloadTool(config),
    }));
    register(definePlainTool({
        name: "browser_status",
        description: "查看浏览器会话是否打开、当前 URL 与标题。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                open: { type: "boolean" },
                profile: { type: "string" },
                channel: { type: "string" },
                tabs: { type: "integer" },
                profiles: { type: "array", items: { type: "object" } },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["open", "profile", "channel", "tabs", "profiles"],
        },
        render: (_args, value) => value.open ? `Open (${value.channel}): ${value.url} — ${value.title}` : "Not open",
        timeoutMs: timeout(),
        execute: () => statusTool(),
    }));
    register(definePlainTool({
        name: "browser_close",
        description: "关闭浏览器会话并释放资源;下次使用工具时会自动重新打开。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: { closed: { type: "boolean" } },
            required: ["closed"],
        },
        render: () => "Browser closed",
        execute: () => closeTool(),
    }));
    register(definePlainTool({
        name: "browser_tabs",
        description: "管理浏览器多标签页:list 列出所有标签,new 新建(可选带 url),switch 按 id 或 index 切换,close 关闭指定标签。id 来自 list 结果。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "new", "switch", "close"] },
                url: { type: "string", description: "new 时打开的新标签 URL。" },
                id: { type: "integer", description: "目标标签 id(list 返回)。" },
                index: { type: "integer", description: "目标标签序号(0 起)。" },
                waitUntil: { type: "string", enum: ["load", "domcontentloaded", "commit"] },
                timeoutMs: { type: "integer" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                action: { type: "string" },
                tab: { type: "object" },
                tabs: { type: "array", items: { type: "object" } },
                activeId: { type: "integer" },
            },
            required: ["action", "tabs", "activeId"],
        },
        render: (args, value) => {
            const lines = value.tabs.map((t) => `${t.id === value.activeId ? "▶" : " "} #${t.id} ${t.url}${t.title ? ` — ${t.title}` : ""}`);
            return `tabs ${value.action}: ${lines.join("\n") || "(none)"}`;
        },
        timeoutMs: timeout(),
        execute: (args) => tabsTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_download",
        description: "获取页面上最近触发的下载(如点击下载链接后),保存到工作区 .dsh-browser/downloads/ 并返回路径。index 可选,默认最近一次;wait=true 时先轮询等待新下载出现(以调用时刻为基线,默认等 10 秒),避免 browser_wait 盲等;浏览器会话关闭后下载记录丢失。",
        parameters: {
            type: "object",
            properties: {
                index: { type: "integer", description: "下载记录序号(0 起,默认最近)。" },
                wait: { type: "boolean", description: "等待新下载出现再取,默认 false。" },
                timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000,上限 60000。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                path: { type: "string" },
                filename: { type: "string" },
                url: { type: "string" },
                bytes: { type: "integer" },
            },
            required: ["path", "filename", "url", "bytes"],
        },
        render: (_args, value) => `Downloaded ${value.filename} (${value.bytes} bytes) → ${value.path}`,
        timeoutMs: timeout(),
        execute: (args, exec) => downloadTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_upload",
        description: "把本地文件上传到页面的文件输入框(selector 指向 input[type=file])。path 可以是绝对路径或相对工作区的路径。",
        parameters: {
            type: "object",
            properties: {
                selector: { type: "string", description: "文件输入框的 CSS 选择器。" },
                path: { type: "string", description: "要上传的文件路径。" },
                timeoutMs: { type: "integer" },
            },
            required: ["selector", "path"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                uploaded: { type: "string" },
                bytes: { type: "integer" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["uploaded", "bytes", "url", "title"],
        },
        render: (args, value) => `Uploaded ${value.uploaded} (${value.bytes} bytes) to ${args.selector}`,
        timeoutMs: timeout(),
        execute: (args, exec) => uploadTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_cookies",
        description: "管理浏览器 Cookie:list 列出当前页面域名的 Cookie(默认隐藏值,showValues=true 显示),set 设置一个 Cookie(可指定 url,默认当前页面),clear 清空全部。用于处理登录态。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "set", "clear"] },
                url: { type: "string", description: "list 的过滤域名或 set 的归属 URL。" },
                name: { type: "string", description: "set 时的 Cookie 名。" },
                value: { type: "string", description: "set 时的 Cookie 值。" },
                showValues: { type: "boolean" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                cookies: { type: "array", items: { type: "object" } },
                set: { type: "boolean" },
                cleared: { type: "boolean" },
                name: { type: "string" },
                url: { type: "string" },
            },
            required: [],
        },
        render: (_args, value) => {
            if (value.cleared)
                return "All cookies cleared";
            if (value.set)
                return `Cookie ${value.name} set for ${value.url}`;
            return (value.cookies ?? [])
                .map((c) => `${c.name}=${c.value} (${c.domain}${c.path}, httpOnly=${c.httpOnly})`)
                .join("\n") || "(no cookies)";
        },
        timeoutMs: timeout(),
        execute: (args) => cookiesTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_form",
        description: "批量填充表单:fields 数组,每项给 selector(CSS)或 label(可见文本)与 value;submit=true 时填完按回车提交。也可 from=<已保存表单名> 回放(browser_form_save 保存)。先 browser_elements 或 browser_snapshot 了解表单结构。",
        parameters: {
            type: "object",
            properties: {
                fields: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            selector: { type: "string" },
                            label: { type: "string" },
                            value: { type: "string" },
                        },
                    },
                    description: "要填充的字段列表(from 回放时省略)。",
                },
                from: { type: "string", description: "回放已保存表单的名称。" },
                submit: { type: "boolean" },
                timeoutMs: { type: "integer" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                filled: { type: "array", items: { type: "object" } },
                submit: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["filled", "submit", "url", "title"],
        },
        render: (args, value) => `Filled ${value.filled.length} field(s)${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args) => formTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_form_save",
        description: "把最近一次 browser_form 填充的字段保存为命名表单(或直接传 fields),之后 browser_form 用 from=<name> 一键回放。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "表单名(回放时用)。" },
                fields: { type: "array", items: { type: "object" }, description: "可选,不传则用最近一次填充。" },
            },
            required: ["name"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                saved: { type: "string" },
                fields: { type: "integer" },
            },
            required: ["saved", "fields"],
        },
        render: (_args, value) => `Saved form "${value.saved}" with ${value.fields} field(s)`,
        timeoutMs: timeout(),
        execute: (args) => formSaveTool(args),
    }));
    register(definePlainTool({
        name: "browser_forms",
        description: "管理已保存的表单回放:list 列出,delete 删除指定表单。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "delete"] },
                name: { type: "string", description: "delete 时的表单名。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                forms: { type: "array", items: { type: "object" } },
                deleted: { type: "boolean" },
                name: { type: "string" },
            },
            required: [],
        },
        render: (args, value) => {
            if (args.action === "delete")
                return value.deleted ? `Deleted "${value.name}"` : `No form "${value.name}"`;
            return (value.forms ?? [])
                .map((f) => `"${f.name}" (${f.fields} fields): ${f.preview}`)
                .join("\n") || "(no saved forms)";
        },
        timeoutMs: timeout(),
        execute: (args) => formsTool(args),
    }));
    register(definePlainTool({
        name: "browser_profile",
        description: "多浏览器配置文件:list 列出配置的 profiles(work/personal…)与当前会话状态,use <name> 切换当前 profile(后续浏览器工具作用于该 profile)。每个 profile 可配置独立 userDataDir(登录态隔离)。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "use"] },
                name: { type: "string", description: "use 时的 profile 名(default 或配置的)。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                current: { type: "string" },
                profiles: { type: "array", items: { type: "object" } },
            },
            required: ["current", "profiles"],
        },
        render: (args, value) => {
            if (args.action === "use")
                return `Switched to profile "${value.current}"`;
            return value.profiles
                .map((p) => `${p.name === value.current ? "▶" : " "} ${p.name}${p.open ? ` (open, ${p.tabs} tabs${p.persistent ? ", persistent" : ""})` : " (closed)"}${p.userDataDir ? ` → ${p.userDataDir}` : ""}`)
                .join("\n") || "(no profiles configured)";
        },
        timeoutMs: timeout(),
        execute: (args) => profileTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_wait_for_login",
        description: "等待人工登录完成。agent 在登录页调用本工具后,提示用户在浏览器窗口中完成登录(有头模式 headless:false 时用户可直接操作;配 userDataDir 登录态会持久化)。成功条件三选一:successSelector(登录后出现的元素,如 '#avatar')或 successUrl(登录后 URL 正则,如 'https://\\\\.app\\\\.example\\\\.com')都不给则 URL 发生变化即视为完成。轮询间隔 2 秒,超时返回 loggedIn:false。",
        parameters: {
            type: "object",
            properties: {
                timeoutMs: { type: "integer", description: "等待上限(毫秒,默认 120000,上限 600000)。" },
                successSelector: { type: "string", description: "登录成功后应出现的 CSS 选择器。" },
                successUrl: { type: "string", description: "登录成功后 URL 应匹配的正则。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                loggedIn: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["loggedIn", "url", "title"],
        },
        render: (_args, value) => value.loggedIn ? `登录完成: ${value.url}` : `等待登录超时,仍在: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args) => waitForLoginTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_pause_for_human",
        description: "人工接管等待:agent 把控制权暂时交还给用户,适用于验证码/短信确认/二次复核/敏感步骤人工兜底等场景。调用后提示(instruction)会显示在界面右下角实时画面面板,等待用户在浏览器窗口中完成操作。完成条件三选一:successSelector(完成后出现的元素)、successUrl(完成后 URL 匹配的正则),都不给则 URL 或页面内容发生变化即视为完成。轮询间隔 2 秒;超时不抛错,返回 completed:false,agent 可再次调用或改走其他路径。",
        parameters: {
            type: "object",
            properties: {
                instruction: { type: "string", description: "给用户看的提示语,如「请在浏览器中输入短信验证码」。" },
                timeoutMs: { type: "integer", description: "等待上限(毫秒,默认 300000,下限 1000,上限 600000)。" },
                successSelector: { type: "string", description: "完成后应出现的 CSS 选择器。" },
                successUrl: { type: "string", description: "完成后 URL 应匹配的正则。" },
            },
            required: ["instruction"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                completed: { type: "boolean" },
                status: { type: "string", enum: ["completed", "timedOut"] },
                instruction: { type: "string" },
                detail: { type: "string" },
                waitedMs: { type: "integer" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["completed", "status", "instruction", "detail", "waitedMs", "url", "title"],
        },
        render: (_args, value) => value.completed
            ? `人工操作完成(${value.waitedMs}ms): ${value.url}`
            : `等待人工操作超时(${value.waitedMs}ms): ${value.instruction} — ${value.detail}`,
        timeoutMs: timeout(600_000),
        execute: (args) => pauseForHumanTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_confirm",
        description: "敏感操作审批:在执行提交/删除/支付等不可逆或影响线上数据的动作前调用,审批请求(含 reason 与将执行的操作)会推送到界面右下角实时画面面板,等待用户点「允许/拒绝」。用户允许时返回 decision:'allowed';用户拒绝或等待超时(默认 60s,fail-closed)**抛错**,live 调用与 replay/batch 步骤统一按失败处理。confirmMode:'manual' 时 systemPrompt 会要求所有敏感动作前必须先过本工具。",
        parameters: {
            type: "object",
            properties: {
                reason: { type: "string", description: "给用户看的审批理由:要执行什么操作、影响是什么。" },
                tool: { type: "string", description: "可选:即将执行的工具名,如 'browser_click'。" },
                args: { type: "object", description: "可选:即将执行的工具参数(如 { selector: '#submit' }),供面板展示。" },
                timeoutMs: { type: "integer", description: "等待决策上限(毫秒,默认取配置 confirmTimeoutMs=60000,下限 1000,上限 600000)。" },
            },
            required: ["reason"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                decision: { type: "string", enum: ["allowed"] },
                id: { type: "string" },
                reason: { type: "string" },
                waitedMs: { type: "integer" },
                detail: { type: "string" },
            },
            required: ["decision", "id", "reason", "waitedMs", "detail"],
        },
        render: (_args, value) => `用户允许执行(${value.waitedMs}ms): ${value.reason}`,
        timeoutMs: timeout(600_000),
        execute: (args) => confirmTool(config, args),
    }));
    register(definePlainTool({
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
    }));
    register(definePlainTool({
        name: "browser_doctor",
        description: "浏览器环境健康诊断(不启动浏览器):检查可执行文件/channel、playwright-core 可用性、userDataDir 与截图/下载/基线目录写权限、工作区基准目录解析来源、当前会话状态、面板 API 可达性。环境异常(文件落错位置/浏览器起不来)时先跑本工具定位,每项失败检查附修复建议。",
        parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                checks: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            ok: { type: "boolean" },
                            detail: { type: "string" },
                            advice: { type: "string" },
                        },
                        required: ["name", "ok", "detail"],
                        additionalProperties: false,
                    },
                },
                summary: {
                    type: "object",
                    properties: { ok: { type: "boolean" }, passed: { type: "integer" }, failed: { type: "integer" } },
                    required: ["ok", "passed", "failed"],
                    additionalProperties: false,
                },
            },
            required: ["checks", "summary"],
        },
        render: (_args, value) => {
            const lines = value.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}${c.advice ? `\n    建议: ${c.advice}` : ""}`);
            return `诊断 ${value.summary.ok ? "通过" : "发现问题"}(${value.summary.passed}/${value.checks.length})\n${lines.join("\n")}`;
        },
        timeoutMs: timeout(15_000),
        execute: (args, exec) => doctorTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_context",
        description: "命名隔离上下文:同一浏览器进程内 cookies/storage 完全隔离的\"标签组\"。action:new(name 可省略自动编号,可选 url 直接打开)/ list / switch(name,激活该组页面,组内页全关则在原 context 新开,登录态仍在)/ close(name,整组关闭)。适合多账号并行验证、需要干净会话的抓取。页注册进普通标签表,所有浏览器工具直接可用;browser_tabs 也能看到/切换这些页。持久模式(userDataDir)不支持,请改用 profiles。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "new", "switch", "close"], description: "默认 list。" },
                name: { type: "string", description: "上下文名(new 自动编号时可省略;switch/close 必填)。" },
                url: { type: "string", description: "new 时可选:新页直接打开的 URL。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                contexts: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            pages: { type: "integer" },
                            active: { type: "boolean" },
                            createdAt: { type: "integer" },
                        },
                        required: ["name", "pages", "active", "createdAt"],
                        additionalProperties: false,
                    },
                },
                profile: { type: "string" },
                created: { type: "string" },
                navigated: { type: "string" },
                switched: { type: "string" },
                closed: { type: "string" },
                remainingTabs: { type: "integer" },
                pages: { type: "integer" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: [],
        },
        render: (args, value) => {
            if (args.action === "new" || value.created)
                return `新建隔离上下文 "${value.created}"${value.navigated ? ` → ${value.navigated}` : ""}`;
            if (args.action === "switch" || value.switched)
                return `切换到上下文 "${value.switched}": ${value.url}`;
            if (args.action === "close" || value.closed)
                return `关闭上下文 "${value.closed}"(剩余 ${value.remainingTabs} 标签)`;
            return (value.contexts.map((c) => `${c.active ? "▶" : " "} ${c.name}(${c.pages} 页)`).join("\n") ||
                "(无隔离上下文;browser_context { action: \"new\" } 创建)");
        },
        timeoutMs: timeout(),
        execute: (args) => contextTool(config, args),
    }));
    register(definePlainTool({
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
    }));
    register(definePlainTool({
        name: "browser_wait_for",
        description: "通用显式等待(测试同步原语):轮询直到条件成立或超时抛错。condition 四类:1) {selector:'#btn', state:'visible|hidden|attached|detached'} 元素状态(默认 visible);2) {url:'正则字符串'} 当前 URL 匹配;3) {text:'子串'} 页面可见文本包含;4) {count:{selector,op:'eq|gt|gte|lt|lte',value}} 元素数量比较;5) {eval:'JS 表达式'} 求值 truthy。用于等页面渲染、等请求完成、等元素出现。",
        parameters: {
            type: "object",
            properties: {
                condition: {
                    type: "object",
                    description: "等待条件(见描述,五选一)。",
                },
                timeoutMs: { type: "integer", description: "超时毫秒,默认 10000,上限 120000。" },
                intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 500。" },
            },
            required: ["condition"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                met: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["met", "url", "title"],
        },
        render: (_args, value) => `等待条件满足: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args) => waitForTool(config, args),
    }));
    register(definePlainTool({
        name: "browser_assert",
        description: "结构化断言(测试核心):condition 在 timeoutMs 内成立则通过(条件格式同 browser_wait_for,另支持 ref)。失败时自动截图存证据目录(assert-fail-*.png)并抛错,错误消息含原因与截图路径。另支持视觉回归:传 visual={baseline, threshold?, maxDiffRatio?, mask?} 与基线截图做像素比对(browser_screenshot 的 baseline 建立基线;mask 为忽略的选择器数组,如时钟/广告位),失败时产出当前截图与红标 diff 图。适合断言登录成功、关键元素出现、接口返回、文本正确、页面无视觉回归。",
        parameters: {
            type: "object",
            properties: {
                condition: { type: "object", description: "断言条件(同 browser_wait_for,另支持 {ref, state})。" },
                visual: {
                    type: "object",
                    description: "视觉断言:{ baseline: 基线名, threshold?: 像素亮度阈值(默认0.1), maxDiffRatio?: 允许的差异像素比例(默认0.005), mask?: 忽略区域选择器数组 }。",
                },
                timeoutMs: { type: "integer", description: "断言超时毫秒,默认 5000,上限 60000。" },
                intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 300。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                passed: { type: "boolean" },
                url: { type: "string" },
                title: { type: "string" },
                visual: { type: "object" },
            },
            required: ["passed", "url", "title"],
        },
        render: (_args, value) => `断言通过: ${value.url}`,
        timeoutMs: timeout(),
        execute: (args, exec) => assertTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_network",
        description: "网络记录查询(自动记录页面 XHR/fetch 接口请求,含请求/响应体截断存储,每 profile 上限 500 条)。action:list 列出(可按 urlSubstr/method/status 过滤,limit 默认 50);failed 只列失败/4xx5xx;wait 等待某个 url 正则匹配的接口出现(带 timeoutMs,命中返回 waitMs);stats 按 host 聚合计数/失败数/平均耗时/状态码分布;clear 清空记录。适合断言接口出入参、排查 4xx/5xx。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "failed", "wait", "stats", "clear"], description: "默认 list。" },
                urlSubstr: { type: "string", description: "URL 子串过滤(list/failed)。" },
                method: { type: "string", description: "HTTP 方法过滤(list/failed)。" },
                status: { type: "integer", description: "状态码过滤(list/failed)。" },
                limit: { type: "integer", description: "返回条数上限,默认 50。" },
                url: { type: "string", description: "wait 时的 URL 正则。" },
                timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                entries: { type: "array", items: { type: "object" } },
                failed: { type: "array", items: { type: "object" } },
                stats: { type: "array", items: { type: "object" } },
                matched: { type: "object" },
                waitMs: { type: "integer" },
                cleared: { type: "boolean" },
            },
            required: [],
        },
        render: (_args, value) => {
            if (value.cleared)
                return "网络记录已清空";
            if (value.stats) {
                return value.stats
                    .map((s) => `${s.host}  共${s.total} 失败${s.failed} 均耗时${s.avgMs ?? "-"}ms  ${JSON.stringify(s.byStatus)}`)
                    .join("\n") || "(无记录)";
            }
            const list = value.entries ?? value.failed ?? (value.matched ? [value.matched] : []);
            return list
                .map((e) => {
                const head = `${e.method} ${e.url} → ${e.failed ? "FAILED" : (e.ok ? e.status : e.status + " !")}${e.durationMs !== undefined ? ` ${e.durationMs}ms` : ""}`;
                const reqBody = e.postData ? `\n  req: ${String(e.postData).slice(0, 160)}` : "";
                const resBody = e.body ? `\n  res: ${String(e.body).slice(0, 240)}` : "";
                return head + reqBody + resBody;
            })
                .join("\n") || "(无记录)";
        },
        timeoutMs: timeout(),
        execute: (args) => networkTool(args),
    }));
    register(definePlainTool({
        name: "browser_record",
        description: "操作录制(回归测试数据源):start 开始录制(后续浏览器工具调用自动记录,selector 步骤附带元素指纹),stop 结束并返回步数,save <name> 保存(start→stop 的录制 buffer 优先,否则取最近 100 次调用;stripReads=true 剔除只读探查步骤;vars 可把指定步骤字段抽成 {{占位符}} 实现参数化回放;upload 引用的本地文件缺失时返回 warnings),list/delete 管理。配合 browser_replay 一键回放。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["start", "stop", "save", "list", "delete"], description: "默认 start。" },
                name: { type: "string", description: "save/delete 时的录制名。" },
                stripReads: { type: "boolean", description: "save 时剔除只读步骤(snapshot/elements/eval/network/status/cookies list),默认 false。" },
                includeFailed: { type: "boolean", description: "save 时保留失败的实验步骤(默认剔除:超时/无效 selector 的步骤回放必然再次失败并卡住回放)。" },
                vars: {
                    type: "object",
                    description: "save 时参数化:{ 变量名: \"#步骤号.args.字段\" }(步骤号 1 起),该字段值替换为 {{变量名}} 占位符;replay 时用 vars 传入真实值。",
                },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                recording: { type: "boolean" },
                steps: { type: "integer" },
                stripped: { type: "integer" },
                skippedFailed: { type: "integer", description: "save 时默认剔除的失败实验步骤数。" },
                varsApplied: { type: "integer" },
                saved: { type: "string" },
                source: { type: "string" },
                file: { type: "string" },
                warnings: { type: "array", items: { type: "string" } },
                recordings: { type: "array", items: { type: "object" } },
                deleted: { type: "boolean" },
                name: { type: "string" },
                hint: { type: "string" },
            },
            required: [],
        },
        render: (args, value) => {
            if (args.action === "start")
                return "开始录制(后续浏览器调用将记录)";
            if (args.action === "stop")
                return `录制结束,共 ${value.steps} 步(browser_record save <name> 保存)`;
            if (args.action === "save") {
                const warn = (value.warnings ?? []).length > 0 ? `\n⚠️ ${value.warnings.join("\n⚠️ ")}` : "";
                const stripped = typeof value.stripped === "number" ? `(已剔除 ${value.stripped} 个只读步骤)` : "";
                const vars = typeof value.varsApplied === "number" ? `(参数化 ${value.varsApplied} 个变量)` : "";
                return `已保存录制 "${value.saved}"(${value.steps} 步,来源: ${value.source === "recording" ? "start→stop 录制" : "最近操作轨迹"})${stripped}${vars}${warn}`;
            }
            if (args.action === "delete")
                return value.deleted ? `已删除 "${value.name}"` : `无此录制 "${value.name}"`;
            return (value.recordings ?? []).map((r) => `"${r.name}"(${r.steps} 步): ${r.preview}`).join("\n") || "(无录制)";
        },
        timeoutMs: timeout(),
        execute: (args) => recordTool(args),
    }));
    register(definePlainTool({
        name: "browser_replay",
        description: "回放录制或步骤序列(回归测试):name 指定已保存录制(browser_record save),或直接传 steps 数组(每步 {tool, args})。failFast 默认 true(遇错停止);返回每步结果与汇总。选择器自愈:录制时保存了元素指纹的步骤,原 selector 失败时自动按 testid→role+name→text→id 降级重试并在结果中标 healed(建议事后修复录制选择器)。参数化:录制含 {{占位符}} 时用 vars 注入;data 传对象数组或 dataFile 传 CSV 路径(首行为变量名)可逐行数据驱动回放。运行结果自动记入回归历史(browser_report 可导出报告)。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "已保存录制名(与 steps 二选一)。" },
                steps: { type: "array", items: { type: "object" }, description: "步骤数组 [{tool, args}](可含 meta.hint 指纹)。" },
                failFast: { type: "boolean", description: "遇错即停,默认 true(data 模式为行内 failFast,不中断后续行)。" },
                vars: { type: "object", description: "{{占位符}} 的注入值,如 { username: \"a@x.com\" }。" },
                data: { type: "array", items: { type: "object" }, description: "数据集:每行一个对象,逐行回放一次。" },
                dataFile: { type: "string", description: "数据集 CSV 文件(工作区相对路径,首行为变量名)。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                source: { type: "string" },
                total: { type: "integer" },
                passed: { type: "integer" },
                failed: { type: "integer" },
                healedCount: { type: "integer" },
                stoppedAt: { type: "integer" },
                results: { type: "array", items: { type: "object" } },
                summary: { type: "string" },
                rows: { type: "integer" },
                passedRows: { type: "integer" },
                failedRows: { type: "integer" },
                runs: { type: "array", items: { type: "object" } },
            },
            required: ["source", "total", "passed", "failed", "healedCount", "results", "summary"],
        },
        render: (_args, value) => {
            const rowsInfo = value.runs !== undefined
                ? `${value.summary}\n${value.runs.map((r) => `${(r.failed ?? 0) === 0 ? "✓" : "✗"} 行${r.row}${r.error ? ` — ${String(r.error).slice(0, 100)}` : ` ${r.passed}/${r.total}`}`).join("\n")}`
                : `${value.summary}\n${(value.results ?? []).map((r) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.healed ? ` [自愈:${r.via}]` : ""}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`;
            return rowsInfo;
        },
        timeoutMs: timeout(),
        execute: (args, exec) => replayTool(args, stepImpls, config, exec),
    }));
    register(definePlainTool({
        name: "browser_batch",
        description: "动作批处理:一次调用顺序执行多个浏览器步骤 [{tool, args}](内核同 browser_replay),减少「点击→等待→输入→回车」类固定小序列的往返。failFast 默认 true(遇错停);步骤内禁止嵌套 browser_batch/browser_replay/browser_record;批整体在操作轨迹/录制里记为单条步骤(可录制、可回放)。",
        parameters: {
            type: "object",
            properties: {
                steps: { type: "array", items: { type: "object" }, description: "步骤数组 [{tool, args}]。" },
                failFast: { type: "boolean", description: "遇错即停,默认 true。" },
            },
            required: ["steps"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                total: { type: "integer" },
                passed: { type: "integer" },
                failed: { type: "integer" },
                healedCount: { type: "integer" },
                stoppedAt: { type: "integer" },
                results: { type: "array", items: { type: "object" } },
                summary: { type: "string" },
            },
            required: ["total", "passed", "failed", "healedCount", "results", "summary"],
        },
        render: (_args, value) => `${value.summary}\n${(value.results ?? []).map((r) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`,
        timeoutMs: timeout(),
        execute: (args) => batchTool(args, stepImpls),
    }));
    register(definePlainTool({
        name: "browser_extract",
        description: "规则化结构化抽取(网站信息获取):fields 定义抽取结构 [{name, selector, attr?, multiple?, fields?}](attr 缺省取可见文本,可指定 href/src 等属性;multiple=true 收集所有命中;fields 嵌套可在行内抽子字段);next 传翻页选择器自动翻页聚合(maxPages 上限,next 消失/禁用即停);format 支持 json/csv/jsonl/markdown,file 落盘到工作区(自动按扩展名推断格式,拒绝路径穿越)。语义化抽取(如「总结要点」)不在此工具范围——用 browser_snapshot 读文本后交 jev_extract。",
        parameters: {
            type: "object",
            properties: {
                fields: {
                    type: "array",
                    items: { type: "object" },
                    description: "抽取字段定义 [{name, selector, attr?, multiple?, fields?}]。",
                },
                next: { type: "string", description: "翻页「下一页」选择器(可选)。" },
                maxPages: { type: "integer", description: "翻页上限,默认 1,上限 100。" },
                waitAfterMs: { type: "integer", description: "翻页后等待毫秒,默认 800。" },
                maxRows: { type: "integer", description: "聚合行数上限,默认 1000。" },
                format: { type: "string", enum: ["json", "csv", "jsonl", "markdown"], description: "序列化格式(默认 json;file 有扩展名时自动推断)。" },
                file: { type: "string", description: "落盘路径(工作区相对或绝对,限工作区内)。" },
            },
            required: ["fields"],
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                rows: { type: "array", items: { type: "object" } },
                count: { type: "integer" },
                pages: { type: "integer" },
                format: { type: "string" },
                truncated: { type: "boolean" },
                file: { type: "string" },
                bytes: { type: "integer" },
                url: { type: "string" },
                title: { type: "string" },
            },
            required: ["rows", "count", "pages", "format", "truncated", "url", "title"],
        },
        render: (_args, value) => `抽取 ${value.count} 行 / ${value.pages} 页${value.truncated ? "(已截断)" : ""}${value.file ? ` → ${value.file} (${value.bytes} bytes)` : ""}`,
        timeoutMs: timeout(),
        execute: (args, exec) => extractTool(config, args, exec),
    }));
    register(definePlainTool({
        name: "browser_report",
        description: "回归运行报告:每次 browser_replay / browser_batch 的结果自动记入运行历史。action=list 列出最近运行;show 查看单条详情(runId 省略取最近一条);export 聚合生成报告落盘工作区(format=markdown|html,含运行趋势、失败步骤 Top、自愈步骤清单,source 可只看某个录制)。配合 DSH 的 schedule 能力可实现定时回归+定期报告。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["list", "show", "export"], description: "默认 list。" },
                runId: { type: "string", description: "show 时的运行 id(省略取最近一条)。" },
                format: { type: "string", enum: ["markdown", "html"], description: "export 格式,默认 markdown。" },
                source: { type: "string", description: "export 时只聚合该来源(录制名)的运行。" },
                file: { type: "string", description: "export 落盘路径(工作区内,默认 reports/regression-<日期>.md)。" },
                limit: { type: "integer", description: "list/export 聚合的运行条数上限,list 默认 20、export 默认 50。" },
            },
            additionalProperties: false,
        },
        outputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                runs: {}, // list 时为数组,export 时为条数(integer)
                run: { type: "object" },
                file: { type: "string" },
                bytes: { type: "integer" },
                format: { type: "string" },
            },
            required: [],
        },
        render: (args, value) => {
            if (args.action === "export") {
                return `已导出 ${value.runs} 次运行 → ${value.file} (${value.bytes} bytes, ${value.format})`;
            }
            if (args.action === "show") {
                const r = value.run ?? {};
                return `${r.source}${r.row !== undefined ? ` 行${r.row}` : ""}: ${r.passed}/${r.total} 通过,自愈 ${r.healedCount},runId=${r.runId}`;
            }
            return (value.runs ?? [])
                .map((r) => `${r.failed === 0 ? "✓" : "✗"} ${new Date(r.ts).toLocaleString("zh-CN", { hour12: false })} ${r.source}${r.row !== undefined ? ` 行${r.row}` : ""}: ${r.passed}/${r.total}${r.healedCount > 0 ? ` (自愈${r.healedCount})` : ""}`)
                .join("\n") || "(暂无运行记录)";
        },
        timeoutMs: timeout(),
        execute: (args, exec) => reportTool(config, args, exec),
    }));
}
//# sourceMappingURL=register.js.map