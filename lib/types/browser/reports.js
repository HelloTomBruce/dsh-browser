// dsh-browser · 回归运行历史与报告($DSH_HOME/.dsh-browser/reports/runs.jsonl)
//
// 每次 browser_replay / browser_batch 完成即追加一条运行记录(JSONL,单写者)。
// 超 5MB 或 1000 条时截断旧行(原子替换)。export 聚合为 Markdown / 自包含 HTML。
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** 报告存储目录($DSH_HOME/.dsh-browser/reports)。 */
export function reportsDir() {
    const home = process.env.DSH_HOME || join(homedir(), ".dsh");
    return join(home, ".dsh-browser", "reports");
}
function runsFile() {
    return join(reportsDir(), "runs.jsonl");
}
/** 生成 runId:YYYYMMDD-HHmmss-随机4位。 */
export function makeRunId(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}
const MAX_LINES = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
/** 追加一条运行记录;超限时截断旧行(原子替换)。 */
export function appendRun(record) {
    const dir = reportsDir();
    mkdirSync(dir, { recursive: true });
    const file = runsFile();
    appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
    let size = 0;
    try {
        size = statSync(file).size;
    }
    catch {
        return;
    }
    if (size <= MAX_BYTES) {
        // 条数检查:行数便宜读取,超 1000 才截断(通过行数估算快速跳过)
        try {
            const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
            if (lines.length <= MAX_LINES)
                return;
            const kept = lines.slice(-MAX_LINES).join("\n") + "\n";
            const tmp = `${file}.tmp`;
            writeFileSync(tmp, kept, "utf8");
            renameSync(tmp, file);
        }
        catch {
            /* 截断失败不影响主流程 */
        }
        return;
    }
    try {
        const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
        const kept = lines.slice(-MAX_LINES).join("\n") + "\n";
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, kept, "utf8");
        renameSync(tmp, file);
    }
    catch {
        /* 同上 */
    }
}
/** 读取全部运行记录(按时间倒序);坏行静默跳过。 */
export function listRuns(limit = 50) {
    let lines = [];
    try {
        lines = readFileSync(runsFile(), "utf8").split("\n").filter((l) => l.trim() !== "");
    }
    catch {
        return [];
    }
    const runs = [];
    for (let i = lines.length - 1; i >= 0 && runs.length < limit; i--) {
        try {
            const r = JSON.parse(lines[i]);
            if (r !== null && typeof r === "object" && typeof r.runId === "string")
                runs.push(r);
        }
        catch {
            /* 坏行跳过 */
        }
    }
    return runs;
}
/** 最近一次运行(无记录返回 null)。 */
export function latestRun() {
    return listRuns(1)[0] ?? null;
}
/** 按 runId 取单条记录。 */
export function getRun(runId) {
    return listRuns(MAX_LINES).find((r) => r.runId === runId) ?? null;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtTs = (ts) => new Date(ts).toLocaleString("zh-CN", { hour12: false });
/** 聚合统计:失败步骤 TopN 与自愈步骤清单(两个渲染器共用)。 */
function analyze(runs) {
    const failMap = new Map();
    const healed = [];
    for (const run of runs) {
        for (const step of run.results) {
            if (!step.ok) {
                const key = `${run.source}|${step.tool}|${step.error ?? ""}`;
                const cur = failMap.get(key);
                if (cur !== undefined)
                    cur.count++;
                else
                    failMap.set(key, { source: run.source, tool: step.tool, error: step.error ?? "", count: 1 });
            }
            else if (step.healed === true) {
                healed.push({
                    ts: run.ts,
                    source: run.source,
                    tool: step.tool,
                    via: step.via ?? "",
                    resolved: step.resolved ?? "",
                });
            }
        }
    }
    const failures = [...failMap.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    return { failures, healed };
}
/** 生成 Markdown 回归报告。 */
export function renderMarkdownReport(runs, source) {
    const title = source !== undefined && source !== "" ? `回归报告 — ${source}` : "回归报告 — 全部来源";
    const lines = [
        `# ${title}`,
        "",
        `> 生成时间:${fmtTs(Date.now())} · 共 ${runs.length} 次运行`,
        "",
        "## 运行趋势(最新在前)",
        "",
        "| 时间 | 来源 | 通过/总数 | 失败 | 自愈 | 耗时 |",
        "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const r of runs) {
        lines.push(`| ${fmtTs(r.ts)} | ${r.source}${r.row !== undefined ? ` (行${r.row})` : ""}${r.retries !== undefined ? ` (重试挽回 ${r.retries.recovered}/${r.retries.attempted})` : ""}${r.retryOf !== undefined ? ` ↻${r.retryOf}` : ""} | ${r.passed}/${r.total} | ${r.failed} | ${r.healedCount} | ${(r.durationMs / 1000).toFixed(1)}s |`);
    }
    const { failures, healed } = analyze(runs);
    lines.push("", "## 失败步骤 Top", "");
    if (failures.length === 0) {
        lines.push("全部通过 🎉");
    }
    else {
        lines.push("| 次数 | 来源 | 步骤 | 错误 |", "| --- | --- | --- | --- |");
        for (const f of failures) {
            lines.push(`| ${f.count} | ${f.source} | ${f.tool} | ${f.error.slice(0, 120).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`);
        }
    }
    if (healed.length > 0) {
        lines.push("", "## 自愈步骤(建议修复录制中的选择器)", "", "| 时间 | 来源 | 步骤 | 自愈方式 | 新选择器 |", "| --- | --- | --- | --- | --- |");
        for (const h of healed.slice(0, 20)) {
            lines.push(`| ${fmtTs(h.ts)} | ${h.source} | ${h.tool} | ${h.via} | \`${h.resolved}\` |`);
        }
    }
    lines.push("");
    return lines.join("\n");
}
/** 生成自包含 HTML 回归报告(内联样式,无外部资源)。 */
export function renderHtmlReport(runs, source) {
    const title = source !== undefined && source !== "" ? `回归报告 — ${source}` : "回归报告 — 全部来源";
    const { failures, healed } = analyze(runs);
    const rowHtml = runs
        .map((r) => {
        const ok = r.failed === 0;
        return `<tr><td>${esc(fmtTs(r.ts))}</td><td>${esc(r.source)}${r.row !== undefined ? ` (行${r.row})` : ""}${r.retries !== undefined ? ` <span class="meta">(重试挽回 ${r.retries.recovered}/${r.retries.attempted})</span>` : ""}${r.retryOf !== undefined ? ` <span class="meta" title="重跑自 ${esc(r.retryOf)}">↻</span>` : ""}</td><td class="${ok ? "ok" : "bad"}">${r.passed}/${r.total}</td><td>${r.failed}</td><td>${r.healedCount}</td><td>${(r.durationMs / 1000).toFixed(1)}s</td></tr>`;
    })
        .join("\n");
    const failRows = failures.length === 0
        ? `<tr><td colspan="4" class="ok">全部通过 🎉</td></tr>`
        : failures
            .map((f) => `<tr><td>${f.count}</td><td>${esc(f.source)}</td><td>${esc(f.tool)}</td><td>${esc(f.error.slice(0, 200))}</td></tr>`)
            .join("\n");
    const healRows = healed
        .slice(0, 20)
        .map((h) => `<tr><td>${esc(fmtTs(h.ts))}</td><td>${esc(h.source)}</td><td>${esc(h.tool)}</td><td>${esc(h.via)}</td><td><code>${esc(h.resolved)}</code></td></tr>`)
        .join("\n");
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2933}
h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #d9e2ec;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f0f4f8}.ok{color:#0f9d58;font-weight:600}.bad{color:#d64545;font-weight:600}
code{background:#f0f4f8;padding:1px 4px;border-radius:4px;font-size:12px}
.meta{color:#7b8794;font-size:13px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">生成时间:${esc(fmtTs(Date.now()))} · 共 ${runs.length} 次运行</p>
<h2>运行趋势(最新在前)</h2>
<table><thead><tr><th>时间</th><th>来源</th><th>通过/总数</th><th>失败</th><th>自愈</th><th>耗时</th></tr></thead>
<tbody>${rowHtml}</tbody></table>
<h2>失败步骤 Top</h2>
<table><thead><tr><th>次数</th><th>来源</th><th>步骤</th><th>错误</th></tr></thead>
<tbody>${failRows}</tbody></table>
${healRows !== "" ? `<h2>自愈步骤(建议修复录制中的选择器)</h2>
<table><thead><tr><th>时间</th><th>来源</th><th>步骤</th><th>自愈方式</th><th>新选择器</th></tr></thead>
<tbody>${healRows}</tbody></table>` : ""}
</body></html>
`;
}
//# sourceMappingURL=reports.js.map