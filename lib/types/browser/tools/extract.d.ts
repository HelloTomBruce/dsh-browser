import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
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
/** suggest 采集的表格单元格信息(页内采集,纯函数消费)。 */
export interface SuggestCell {
    text: string;
    href?: string;
    src?: string;
}
/** suggest 页内分析结果(自包含 injectWalker 注入采集)。 */
export interface SuggestAnalysis {
    ok: boolean;
    /** table: 表格行模式;list: 重复卡片/列表项模式。 */
    kind?: "table" | "list";
    /** 行/卡片选择器(抽取 fields 顶层的 multiple selector)。 */
    rowSelector?: string;
    headerTexts?: string[];
    cells?: SuggestCell[];
    item?: SuggestCell;
    reason?: string;
    overview?: {
        links: number;
        images: number;
        buttons: number;
        headings: number;
        rows: number;
        textChars: number;
    };
}
/** 字段名净化:空白→下划线,限长 30,空回落 col_N。导出供测试。 */
export declare function suggestFieldName(header: string | undefined, index: number): string;
/**
 * 纯逻辑:由表头与首行单元格特征推断表格 fields(单元格文本/链接 href/图片 src)。
 * 返回可直接放进 rows.fields 的嵌套字段数组。导出供测试。
 */
export declare function fieldsFromCells(headerTexts: string[], cells: SuggestCell[]): ExtractField[];
/**
 * 纯逻辑:由首条卡片信息推断列表 fields(项文本/链接/图片)。
 * 文本取第一个子元素(项自身无法用 querySelector 自选)。导出供测试。
 */
export declare function fieldsFromCard(item: SuggestCell): ExtractField[];
/** 纯逻辑:由 fields 与单元格样本拼出首行样例(与抽取输出同构;按 td 序号对位)。导出供测试。 */
export declare function sampleOfFields(fields: ExtractField[], cells: SuggestCell[]): Record<string, unknown>;
/**
 * suggest 汇总(纯逻辑):由页内分析结果组装「可直接交给抽取模式」的顶层 fields
 * (单个 multiple rows 字段 + 行内嵌套字段)与样本。推断失败原样返回。导出供测试。
 */
export declare function suggestWrap(analysis: SuggestAnalysis): {
    suggested: boolean;
    kind?: "table" | "list";
    rowSelector?: string;
    headerTexts?: string[];
    fields?: ExtractField[];
    sample?: Record<string, unknown>;
    reason?: string;
    overview?: SuggestAnalysis["overview"];
};
export declare function extractTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext): Promise<{
    url: string;
    title: string;
    suggested: boolean;
    kind?: "table" | "list";
    rowSelector?: string;
    headerTexts?: string[];
    fields?: ExtractField[];
    sample?: Record<string, unknown>;
    reason?: string;
    overview?: SuggestAnalysis["overview"];
    action: string;
} | {
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
//# sourceMappingURL=extract.d.ts.map