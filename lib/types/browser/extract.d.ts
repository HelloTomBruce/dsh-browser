export declare function toCsv(rows: Record<string, unknown>[]): string;
export declare function toJsonl(rows: Record<string, unknown>[]): string;
export declare function toMarkdownTable(rows: Record<string, unknown>[]): string;
/** 按格式序列化抽取结果(json 为 pretty JSON 字符串)。 */
export declare function serializeRows(rows: Record<string, unknown>[], format: string): string;
/** 由文件扩展名推断序列化格式(显式 format 优先)。 */
export declare function formatFromFile(file: string): string | null;
/**
 * 解析 CSV 文本为行对象数组(首行为表头;支持引号包裹、双引号转义、
 * 逗号/换行内嵌)。供 browser_replay 的 dataFile 使用。
 */
export declare function parseCsv(text: string): Record<string, string>[];
//# sourceMappingURL=extract.d.ts.map