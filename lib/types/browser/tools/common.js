// dsh-browser · 浏览器工具 — 通用工具函数与算法
import { isAbsolute, resolve } from "node:path";
/** 组件库下拉框的可见选项选择器并集(antd / element-plus / 通用 ARIA listbox)。 */
export const DROPDOWN_OPTION_SELECTOR = [
    ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
    ".el-select-dropdown__item",
    "[role='listbox'] [role='option']",
].join(", ");
/** 读取 PNG 文件头(IHDR)中的宽高,不解码像素(导出供测试)。 */
export function pngSize(buf) {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47)
        throw new Error("not a PNG file");
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
/** 按缩放比例换算 mask 矩形(导出供测试;与页内比对共用同一套坐标语义)。 */
export function scaleRects(rects, scale) {
    return rects.map((r) => ({
        x: Math.round(r.x * scale),
        y: Math.round(r.y * scale),
        width: Math.round(r.width * scale),
        height: Math.round(r.height * scale),
    }));
}
/**
 * 快照文本压缩(导出供测试):
 *   - 去掉首尾空白行;
 *   - 连续空白行折叠为 1 行;
 *   - 连续重复的非空行(表格空单元格/占位行产生的噪音)折叠为「首行 + …(重复 N 行)」。
 * 只折叠完全相同的相邻行,不重排、不删改非重复内容。
 */
export function compressText(text) {
    const lines = text.split("\n");
    const out = [];
    let blankRun = 0;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === "") {
            blankRun++;
            if (blankRun === 1 && out.length > 0)
                out.push("");
            continue;
        }
        blankRun = 0;
        // 统计当前行与后续相同行的重复次数
        let dup = 0;
        while (i + dup + 1 < lines.length && lines[i + dup + 1].trim() === trimmed)
            dup++;
        out.push(lines[i]);
        if (dup > 0) {
            out.push(`…(重复 ${dup} 行)`);
            i += dup;
        }
    }
    // 去掉尾部空白行
    while (out.length > 0 && out[out.length - 1] === "")
        out.pop();
    return out.join("\n");
}
/** 最长公共子串长度(小写比较;零依赖,导出供测试)。 */
export function lcsScore(a, b) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    if (x === "" || y === "")
        return 0;
    let best = 0;
    const prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
        let diag = 0;
        for (let j = 1; j <= y.length; j++) {
            const tmp = prev[j];
            prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
            if (prev[j] > best)
                best = prev[j];
            diag = tmp;
        }
    }
    return best;
}
/** 零命中时按相似度挑 top5 候选(导出供测试)。 */
export function topSuggestions(query, candidates, count = 5) {
    // 阈值:短 query(≤3 字符)要求公共子串 ≥1,长 query 要求 ≥2 —— 宁可多给候选
    // 供 agent 二次定位,也不空手而归;完全无公共子串的一律不给(噪音)。
    const min = query.trim().length <= 3 ? 1 : 2;
    return candidates
        .map((c) => ({ ...c, score: lcsScore(query, c.name) }))
        .filter((c) => c.score >= min)
        .sort((a, b) => b.score - a.score)
        .slice(0, count)
        .map(({ role, name, score }) => ({ role, name, score }));
}
/**
 * 行级 diff:掐掉公共前缀/后缀,返回变化区。导出供测试。
 * 全等返回 { unchanged: true };否则 changedFrom 为新文本中变化区首行(1 起)。
 */
export function diffLines(oldText, newText) {
    const a = oldText === "" ? [] : oldText.split("\n");
    const b = newText === "" ? [] : newText.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i])
        i += 1;
    if (i === a.length && i === b.length)
        return { unchanged: true };
    let j = 0;
    while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j])
        j += 1;
    return {
        unchanged: false,
        changedFrom: i + 1,
        lines: b.slice(i, b.length - j),
        removed: a.length - i - j,
    };
}
/** 给本身无超时的 Playwright 调用(evaluate/allTextContents)加有界保护,防页面主线程忙时无限挂起。 */
export async function withTimeout(p, ms, what) {
    let timer;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} 超时(${ms}ms;页面主线程可能正忙)`)), ms);
    });
    try {
        return await Promise.race([p, guard]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
/**
 * 防御性解码 eval 脚本:模型/人工偶发把脚本 JSON.stringify 一次再传
 * (脚本以 \" 开头、换行变字面 \\n),回放/录制链路不纠错会导致语法错误。
 * 识别条件:字符串以引号包裹且含反斜杠转义,且 JSON.parse 结果仍是字符串。
 * 无法解析或语义不变场景原样返回(裸字符串字面量如 "hello" 不含转义,不受影响)。
 */
export function unwrapDoubleEncodedScript(script) {
    if (script.length >= 2 && script.startsWith('"') && script.endsWith('"') && script.includes("\\")) {
        try {
            const parsed = JSON.parse(script);
            if (typeof parsed === "string" && parsed !== script)
                return { script: parsed, unwrapped: true };
        }
        catch {
            /* 不是合法 JSON 字符串字面量,原样使用 */
        }
    }
    return { script, unwrapped: false };
}
/** 工作区内落盘路径解析(拒绝穿越到工作区之外)。 */
export function workspaceFilePath(cwd, file) {
    const p = isAbsolute(file) ? resolve(file) : resolve(cwd, file);
    const root = resolve(cwd);
    if (p !== root && !p.startsWith(root + "/") && !p.startsWith(root + "\\")) {
        throw new Error(`文件路径越出工作区: ${file}`);
    }
    return p;
}
/**
 * 规则化抽取:fields 定义抽取结构,next 选择器驱动翻页(maxPages 上限),
 * 行数超 maxRows 截断;format/file 控制序列化与落盘(json/csv/jsonl/markdown)。
 */
// ---------------------------------------------------------------------------
// F4 extract 字段建议(action: "suggest"):从命中容器首条记录(表格首行/卡片)
// 自动推断字段结构,返回可直接交给抽取模式的 fields + 样本数据;
// 推断不出规律结构时返回原因与容器概览,不猜。
// ---------------------------------------------------------------------------
//# sourceMappingURL=common.js.map