/** 组件库下拉框的可见选项选择器并集(antd / element-plus / 通用 ARIA listbox)。 */
export declare const DROPDOWN_OPTION_SELECTOR: string;
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
 * 行级 diff:掐掉公共前缀/后缀,返回变化区。导出供测试。
 * 全等返回 { unchanged: true };否则 changedFrom 为新文本中变化区首行(1 起)。
 */
export declare function diffLines(oldText: string, newText: string): {
    unchanged: boolean;
    changedFrom?: number;
    lines?: string[];
    removed?: number;
};
/** 给本身无超时的 Playwright 调用(evaluate/allTextContents)加有界保护,防页面主线程忙时无限挂起。 */
export declare function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T>;
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
/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export declare function workspaceFilePath(cwd: string, file: string): string;
/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
//# sourceMappingURL=common.d.ts.map