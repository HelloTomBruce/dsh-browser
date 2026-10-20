import type { Locator, Page } from "playwright-core";
import type { ToolRunContext } from "../lib/types.js";
import type { BrowserConfig, RefEntry, ReplayStep, SelectorHint } from "./types.js";
import { type RunRecord } from "./reports.js";
/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
export declare function pngSize(buf: Buffer): {
    width: number;
    height: number;
};
/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
export declare function scaleRects(rects: {
    x: number;
    y: number;
    width: number;
    height: number;
}[], scale: number): {
    x: number;
    y: number;
    width: number;
    height: number;
}[];
export declare function openTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    status: string;
}>;
/**
 * 快照文本压缩(导出供测试):
 *   - 去掉首尾空白行;
 *   - 连续空白行折叠为 1 行;
 *   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
 * 只折叠完全相同的相邻行,不重排、不删改非重复内容。
 */
export declare function compressText(text: string): string;
/** 最长公共子串长度(小写比较;零依赖,导出供测试)。 */
export declare function lcsScore(a: string, b: string): number;
/** 零命中时按相似度挑 top5 候选(导出供测试)。 */
export declare function topSuggestions(query: string, candidates: {
    role: string;
    name: string;
}[], count?: number): {
    role: string;
    name: string;
    score: number;
}[];
/**
 * 为命中元素增量分配 ref:沿用既有注册表的编号继续(不与上次快照冲突),
 * 合并写回;返回带 ref 的命中列表(上限 maxRefs,超出标 truncated)。
 * 导出供测试(纯逻辑,不依赖浏览器)。
 */
export declare function assignRefs(existing: Map<string, RefEntry>, matches: {
    role: string;
    name: string;
    selector: string;
    ancestors: string[];
}[], maxRefs: number): {
    withRefs: {
        ref: string;
        role: string;
        name: string;
        selector: string;
        ancestors: string[];
    }[];
    merged: Map<string, RefEntry>;
    truncated: boolean;
};
/**
 * 语义元素定位:按名称(或 id/data-testid)在可交互元素中查找,只返回命中的
 * ref + 区域上下文,不输出全量 aria 树 —— 大页面定位单个目标时 token 开销
 * 远小于 browser_snapshot { mode: "aria" }。返回的 ref 可直接用于
 * click/type/select/press。零命中不抛错,附最相近候选供二次定位。
 */
export declare function findTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    scanned: number;
    url: string;
    title: string;
    truncated?: true | undefined;
    suggestions?: {
        role: string;
        name: string;
        score: number;
    }[] | undefined;
    found: number;
    matches: {
        ref: string;
        role: string;
        name: string;
        ancestors: string[];
    }[];
}>;
/**
 * 行级 diff:掐掉公共前缀/后缀,返回变化区。导出供测试。
 * 全等返回 { unchanged: true };否则 changedFrom 为新文本中变化区首行(1 起)。
 */
export declare function diffLines(oldText: string, newText: string): {
    unchanged: boolean;
    changedFrom?: number;
    lines?: string[];
    removed?: number;
};
export declare function snapshotTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    scope?: string | undefined;
    unchanged: boolean;
    contentVersion: number;
} | {
    url: string;
    title: string;
    truncated: boolean;
    scope?: string | undefined;
    diff: boolean;
    contentVersion: number;
    changedFrom: number | undefined;
    removed: number | undefined;
} | {
    url: string;
    title: string;
    truncated: boolean;
    scope?: string | undefined;
    stale?: boolean | undefined;
    contentVersion: number;
}>;
/**
 * 解析点击/输入目标为 Locator:selector 直译;ref 走注册表——
 * 先试快照时的 CSS 路径并校验 role/name 仍一致(防 ref 漂移误点),
 * 不一致则降级 getByRole(role, {name}),均失败报「ref 已失效」。
 */
export declare function targetLocator(page: Page, args: Record<string, any>): Promise<Locator>;
export declare function clickTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    clicked: string;
}>;
export declare function typeTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    typed: boolean;
    selector: string;
    submit: boolean;
}>;
export declare function pressTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    pressed: string;
}>;
/**
 * 下拉选择原语:原生 <select> 走 selectOption;组件库下拉(antd/element/listbox)
 * 走「点击触发框 → 等待可见选项 → 按文本点击」。找不到选项时抛出错误并附当前可见
 * 选项清单,agent 可直接据此修正,无需再手写 eval 探查。
 */
export declare function selectTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    selected: string;
    selector: string;
}>;
/**
 * 防御性解码 eval 脚本:模型/人工偶发把脚本 JSON.stringify 一次再传
 * (脚本以 \" 开头、换行变字面 \\n),回放/录制链路不纠错会导致语法错误。
 * 识别条件:字符串以引号包裹且含反斜杠转义,且 JSON.parse 结果仍是字符串。
 * 无法解析或语义不变场景原样返回(裸字符串字面量如 "hello" 不含转义,不受影响)。
 */
export declare function unwrapDoubleEncodedScript(script: string): {
    script: string;
    unwrapped: boolean;
};
export declare function evalTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    scriptUnwrapped?: boolean | undefined;
    result: unknown;
}>;
export declare function screenshotTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline: string;
} | {
    path: string;
    bytes: number;
    width: number;
    height: number;
    baseline?: undefined;
}>;
export declare function waitTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    waitedMs: number;
}>;
export declare function backTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
export declare function reloadTool(config: BrowserConfig): Promise<{
    url: string;
    title: string;
}>;
/** 一项诊断结果(ok=false 时附 advice 修复建议)。导出供测试。 */
export interface DoctorCheck {
    name: string;
    ok: boolean;
    detail: string;
    advice?: string;
}
export declare function setDoctorProbe(fn: ((basePath: string) => Promise<{
    ok: boolean;
    detail: string;
    advice?: string;
}>) | null): void;
/** 目录可写性检查(mkdir + 写探针文件 + 删除)。导出供测试。 */
export declare function checkWritableDir(dir: string): {
    ok: boolean;
    detail: string;
};
/** 可执行文件存在性检查(executablePath 显式配置用)。导出供测试。 */
export declare function checkExecutable(path: string): DoctorCheck;
/**
 * 命名隔离上下文:同一浏览器进程内独立 cookies/storage 的"标签组"。
 * 页注册进 profile 标签表(所有既有工具直接可用),context 只做归属记录:
 * list / new(name?, url?) / switch(激活该组的一页,没有则新开) / close(整组关闭)。
 * 持久模式(userDataDir)浏览器只有单一 context,不支持本工具(用 profiles 替代)。
 */
export declare function contextTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    contexts: {
        name: string;
        pages: number;
        active: boolean;
        createdAt: number;
    }[];
    profile: string;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    navigated?: string | undefined;
    created: string;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    switched: string;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    url: string;
    title: string;
    switched: string;
    pages: number;
    contexts?: undefined;
    profile?: undefined;
    closed?: undefined;
    remainingTabs?: undefined;
} | {
    closed: string;
    remainingTabs: number;
    contexts?: undefined;
    profile?: undefined;
}>;
/**
 * 操作预告高亮:agent 即将 click/type/select/press 的元素在页面上琥珀色描边
 * ~1.5 秒。异步不阻塞(fire-and-forget,任何失败静默),不影响操作时序。
 */
export declare function previewHighlight(page: Page | null, selector: string, label: string): void;
/** 一次性健康诊断:不启动浏览器,只做静态/本地检查。 */
export declare function doctorTool(config: BrowserConfig, _args: Record<string, any>, exec?: ToolRunContext): Promise<{
    checks: DoctorCheck[];
    summary: {
        ok: boolean;
        passed: number;
        failed: number;
    };
}>;
export declare function statusTool(): Promise<{
    open: boolean;
    profile: string;
    channel: string;
    tabs: number;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        channel: string;
        persistent: boolean;
    }[];
} | {
    url: string;
    title: string;
    open: boolean;
    profile: string;
    channel: string;
    tabs: number;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        channel: string;
        persistent: boolean;
    }[];
}>;
export declare function tabsTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    action: any;
    tabs: {
        id: number;
        url: string;
        title: string;
    }[];
    activeId: number;
    tab?: undefined;
} | {
    action: any;
    tab: {
        id: number;
        url: string;
        title: string;
    };
    tabs: {
        id: number;
        url: string;
        title: string;
    }[];
    activeId: number;
}>;
export declare function resolveTabId(args: Record<string, any>): number;
export declare function downloadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    path: string;
    filename: string;
    url: string;
    bytes: number;
}>;
export declare function uploadTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    uploaded: string;
    bytes: number;
}>;
export declare function cookiesTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    cookies: {
        name: string;
        value: string;
        domain: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Strict" | "Lax" | "None";
        expires: number;
    }[];
    set?: undefined;
    name?: undefined;
    url?: undefined;
    cleared?: undefined;
} | {
    set: boolean;
    name: string;
    url: any;
    cookies?: undefined;
    cleared?: undefined;
} | {
    cleared: boolean;
    cookies?: undefined;
    set?: undefined;
    name?: undefined;
    url?: undefined;
}>;
export declare function formTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    filled: ({
        selector: any;
        label?: undefined;
    } | {
        label: any;
        selector?: undefined;
    })[];
    submit: boolean;
}>;
export declare function formSaveTool(args: Record<string, any>): Promise<{
    saved: string;
    fields: number;
}>;
export declare function formsTool(args: Record<string, any>): Promise<{
    forms: {
        name: string;
        fields: number;
        preview: string;
    }[];
    deleted?: undefined;
    name?: undefined;
} | {
    deleted: boolean;
    name: string;
    forms?: undefined;
}>;
export declare function profileTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    current: string;
    profiles: {
        name: string;
        open: boolean;
        tabs: number;
        persistent: boolean;
        userDataDir: string;
    }[];
}>;
export declare function elementsTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    count: number;
    elements: Record<string, unknown>[];
    dropdownOptions: string[];
}>;
export declare function closeTool(): Promise<{
    closed: boolean;
}>;
/**
 * 条件检查引擎(测试原语共用)。
 *
 * cond 支持四类(每类内部互斥,取第一个存在的字段):
 *   { selector: "#btn", state: "visible|hidden|attached|detached" }  元素状态(默认 visible)
 *   { url: "正则字符串" }                                            当前 URL 匹配
 *   { text: "子串" }                                                  body 可见文本包含
 *   { count: { selector, op: "eq|gt|gte|lt|lte", value: n } }         元素数量比较
 *   { eval: "JS 表达式" }                                            表达式求值 truthy
 */
export type TestCondition = Record<string, any>;
/** 单次检查:返回 { ok, detail }。不抛错,失败时 detail 给出原因。 */
export declare function checkOnce(page: Page, cond: TestCondition): Promise<{
    ok: boolean;
    detail?: string;
}>;
/** 轮询等待条件成立(intervalMs 步进),返回最后一次检查结果。 */
export declare function pollCondition(page: Page, cond: TestCondition, timeoutMs: number, intervalMs?: number): Promise<{
    ok: boolean;
    detail?: string;
}>;
/** 通用显式等待:等待条件成立,超时抛错。 */
export declare function waitForTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    met: boolean;
}>;
/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
 * successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
 * 超时返回 loggedIn:false(不抛错)。
 */
export declare function waitForLoginTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    loggedIn: boolean;
}>;
/**
 * 人工接管等待(通用版 wait_for_login):agent 把控制权交还给用户(验证码 /
 * 二次确认 / 人工复核等)。instruction 会显示在实时画面面板;完成条件三选一:
 * successSelector(元素出现)/ successUrl(URL 正则)/ 两者都不给则以
 * URL 变化或页面内容签名变化视为完成。轮询间隔 2 秒,超时返回 completed:false
 * (不抛错)。导出 runPauseOnPage 供测试注入 fake page。
 */
export declare function runPauseOnPage(page: Page, args: Record<string, any>): Promise<{
    completed: boolean;
    waitedMs: number;
    detail: string;
}>;
/** 人工接管等待工具入口(缺 instruction 在启动浏览器前即校验,失败更快)。 */
export declare function pauseForHumanTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    url: string;
    title: string;
    completed: boolean;
    status: "completed" | "timedOut";
    instruction: string;
    detail: string;
    waitedMs: number;
}>;
/**
 * 敏感操作审批:agent 在执行提交/删除/支付类动作前调用,把审批请求推到实时
 * 画面面板,挂起等待用户点「允许/拒绝」。超时视为拒绝(fail-closed)。
 * 用户允许时返回 { decision: "allowed", ... };拒绝/超时**抛错**(消息含原因),
 * 使 live 调用与 replay/batch 步骤统一按失败处理,agent 不应继续敏感动作。
 * 决策通过 session.resolveConfirm(面板 POST)写入。
 */
export declare function confirmTool(config: BrowserConfig, args: Record<string, any>): Promise<{
    decision: "allowed";
    id: string;
    reason: string;
    waitedMs: number;
    detail: string;
}>;
/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。visual 断言走像素比对。 */
export declare function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    passed: boolean;
    visual: {
        baseline: string;
        diffRatio: number;
        diffPixels: number;
    };
} | {
    url: string;
    title: string;
    passed: boolean;
}>;
/** 网络记录查询:list / failed / wait / clear。 */
export declare function networkTool(args: Record<string, any>): Promise<{
    cleared: boolean;
    entries: never[];
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
} | {
    matched: import("./session.js").NetworkEntry;
    waitMs: number;
    cleared?: undefined;
    entries?: undefined;
    stats?: undefined;
    failed?: undefined;
} | {
    stats: {
        host: string;
        total: number;
        failed: number;
        avgMs: number | null;
        byStatus: Record<string, number>;
    }[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    failed?: undefined;
} | {
    failed: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    entries?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
} | {
    entries: import("./session.js").NetworkEntry[];
    cleared?: undefined;
    matched?: undefined;
    waitMs?: undefined;
    stats?: undefined;
    failed?: undefined;
}>;
/** 使用 args.selector 定位的工具集合(自愈与录制指纹的作用范围)。 */
export declare const SELECTOR_STEP_TOOLS: Set<string>;
/**
 * 采集选择器指向元素的指纹(页内 evaluate;找不到元素返回 null)。
 * 指纹是回放自愈的降级候选来源:testid / role+name / text / id / tag+text。
 */
export declare function captureSelectorHint(page: Page, selector: string): Promise<SelectorHint | null>;
/** 由指纹生成自愈降级候选(按优先级排序;导出供测试)。 */
export declare function healCandidates(hint: SelectorHint): {
    via: string;
    selector: string;
}[];
/** 录制管理:start / stop / save / list / delete。 */
export declare function recordTool(args: Record<string, any>): Promise<{
    recording: boolean;
    hint: string;
    steps?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    recording: boolean;
    steps: number;
    hint?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    hint: string;
    warnings?: string[] | undefined;
    varsApplied?: number | undefined;
    skippedFailed?: number | undefined;
    stripped?: number | undefined;
    saved: string;
    steps: number;
    source: string;
    file: string;
    recording?: undefined;
    recordings?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    recordings: {
        name: string;
        steps: number;
        savedAt: number;
        preview: string;
    }[];
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    deleted?: undefined;
    name?: undefined;
} | {
    deleted: boolean;
    name: string;
    recording?: undefined;
    hint?: undefined;
    steps?: undefined;
    recordings?: undefined;
}>;
/** 回放选项(自愈开关与单次尝试超时,来自 config)。 */
export interface ReplayOptions {
    healing?: boolean;
    healTimeoutMs?: number;
}
/** 回放执行器(步骤 → 工具调用),由 register.ts 注入实现 map。支持选择器自愈。 */
export declare function runReplay(steps: ReplayStep[], impls: Record<string, (args: any) => Promise<unknown>>, failFast: boolean, opts?: ReplayOptions): Promise<{
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
}>;
export interface ExtractField {
    name: string;
    selector: string;
    attr?: string;
    multiple?: boolean;
    fields?: ExtractField[];
}
/**
 * 把单页抽取结果规整为行数组:恰好一个顶层 multiple 字段时,其数组即行
 * (行内嵌套对象为行,标量包装成 { [name]: value });否则整页算一行。
 */
export declare function rowsOfExtract(result: Record<string, any>, fields: ExtractField[]): Record<string, any>[];
/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export declare function workspaceFilePath(cwd: string, file: string): string;
/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
export declare function extractTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    file?: string | undefined;
    bytes?: number | undefined;
    truncated: boolean;
    rows: Record<string, any>[];
    count: number;
    pages: number;
    format: string;
}>;
/**
 * 回归报告:list 列出最近运行,show 看单条详情,
 * export 聚合生成 Markdown/HTML 报告落盘工作区。
 */
export declare function reportTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    runs: {
        row?: number | undefined;
        runId: string;
        ts: number;
        kind: "replay" | "batch";
        source: string;
        total: number;
        passed: number;
        failed: number;
        healedCount: number;
        durationMs: number;
    }[];
    run?: undefined;
    file?: undefined;
    bytes?: undefined;
    format?: undefined;
} | {
    run: RunRecord;
    runs?: undefined;
    file?: undefined;
    bytes?: undefined;
    format?: undefined;
} | {
    file: string;
    bytes: number;
    runs: number;
    format: string;
    run?: undefined;
}>;
/**
 * 动作批处理:一次调用顺序执行多个浏览器步骤(内核复用 runReplay),
 * 减少「点击→等待→输入」类固定小序列的工具往返。步骤内禁止嵌套
 * batch/replay/record;批整体在操作轨迹里记为一条 browser_batch。
 */
export declare function batchTool(args: Record<string, any>, impls: Record<string, (args: any) => Promise<unknown>>, config?: BrowserConfig): Promise<{
    summary: string;
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
}>;
/** 收集步骤中所有 {{var}} 占位符名(导出供测试)。 */
export declare function findPlaceholders(steps: ReplayStep[]): string[];
/**
 * 深拷贝步骤并替换字符串叶子里的 {{var}} 占位符(导出供测试)。
 * vars 缺失的占位符保留原样(由调用方先 findPlaceholders 校验)。
 */
export declare function substituteVars(steps: ReplayStep[], vars: Record<string, unknown>): ReplayStep[];
/**
 * 回放入口:name(已保存录制)或 steps(数组)二选一。
 * vars 注入 {{占位符}};data/dataFile 数据集模式逐行运行并聚合。
 */
export declare function replayTool(args: Record<string, any>, impls: Record<string, (args: any) => Promise<unknown>>, config?: BrowserConfig, exec?: ToolRunContext): Promise<{
    source: string;
    rows: number;
    passedRows: number;
    failedRows: number;
    runs: any[];
    summary: string;
} | {
    summary: string;
    total: number;
    passed: number;
    failed: number;
    healedCount: number;
    stoppedAt?: number;
    results: any[];
    source: string;
    rows?: undefined;
    passedRows?: undefined;
    failedRows?: undefined;
    runs?: undefined;
}>;
//# sourceMappingURL=tools.d.ts.map