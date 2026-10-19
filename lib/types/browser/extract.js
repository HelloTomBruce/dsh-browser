// dsh-browser · 结构化抽取的序列化与 CSV 解析(纯函数,供单测)
/** 把一行里的值转成 CSV 单元格文本(引号双写转义,对象 JSON 化)。 */
function csvCell(value) {
    if (value === null || value === undefined)
        return "";
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** 行的表头:所有行 key 的并集(按首次出现顺序)。 */
function headerOf(rows) {
    const keys = [];
    for (const row of rows) {
        for (const k of Object.keys(row)) {
            if (!keys.includes(k))
                keys.push(k);
        }
    }
    return keys;
}
export function toCsv(rows) {
    const header = headerOf(rows);
    const lines = [header.map(csvCell).join(",")];
    for (const row of rows)
        lines.push(header.map((k) => csvCell(row[k])).join(","));
    return lines.join("\n") + "\n";
}
export function toJsonl(rows) {
    return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}
export function toMarkdownTable(rows) {
    const header = headerOf(rows);
    if (header.length === 0)
        return "(空)\n";
    const cell = (v) => {
        if (v === null || v === undefined)
            return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
    };
    const lines = [
        `| ${header.join(" | ")} |`,
        `| ${header.map(() => "---").join(" | ")} |`,
        ...rows.map((r) => `| ${header.map((k) => cell(r[k])).join(" | ")} |`),
    ];
    return lines.join("\n") + "\n";
}
/** 按格式序列化抽取结果(json 为 pretty JSON 字符串)。 */
export function serializeRows(rows, format) {
    if (format === "csv")
        return toCsv(rows);
    if (format === "jsonl")
        return toJsonl(rows);
    if (format === "markdown")
        return toMarkdownTable(rows);
    return JSON.stringify(rows, null, 2) + "\n";
}
/** 由文件扩展名推断序列化格式(显式 format 优先)。 */
export function formatFromFile(file) {
    if (/\.csv$/i.test(file))
        return "csv";
    if (/\.jsonl$/i.test(file))
        return "jsonl";
    if (/\.(md|markdown)$/i.test(file))
        return "markdown";
    if (/\.json$/i.test(file))
        return "json";
    return null;
}
/**
 * 解析 CSV 文本为行对象数组(首行为表头;支持引号包裹、双引号转义、
 * 逗号/换行内嵌)。供 browser_replay 的 dataFile 使用。
 */
export function parseCsv(text) {
    const rows = [];
    let cur = [];
    let field = "";
    let inQuotes = false;
    let i = 0;
    const pushField = () => {
        cur.push(field);
        field = "";
    };
    const pushRow = () => {
        pushField();
        rows.push(cur);
        cur = [];
    };
    while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i++;
                continue;
            }
            field += ch;
            i++;
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
            i++;
            continue;
        }
        if (ch === ",") {
            pushField();
            i++;
            continue;
        }
        if (ch === "\r") {
            i++;
            continue;
        }
        if (ch === "\n") {
            pushRow();
            i++;
            continue;
        }
        field += ch;
        i++;
    }
    // 收尾:最后一个非空行
    if (field !== "" || cur.length > 0)
        pushRow();
    const header = rows[0]?.map((h) => h.trim()) ?? [];
    const out = [];
    for (let r = 1; r < rows.length; r++) {
        const cells = rows[r];
        if (cells.length === 1 && cells[0] === "")
            continue; // 空行
        const obj = {};
        header.forEach((h, c) => {
            obj[h] = cells[c] ?? "";
        });
        out.push(obj);
    }
    return out;
}
//# sourceMappingURL=extract.js.map