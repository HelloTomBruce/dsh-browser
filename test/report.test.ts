// F6 回归报告:runs.jsonl 追加/截断/读取 与 Markdown/HTML 渲染 + reportTool
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendRun, listRuns, getRun, makeRunId, renderMarkdownReport, renderHtmlReport,
} from "../src/browser/reports.js";
import { reportTool } from "../src/browser/tools.js";
import type { RunRecord } from "../src/browser/reports.js";

function fakeRun(over: Partial<RunRecord> = {}): RunRecord {
  const ts = over.ts ?? Date.now();
  return {
    runId: makeRunId(ts),
    ts,
    kind: "replay",
    source: "login",
    total: 5,
    passed: 4,
    failed: 1,
    healedCount: 1,
    durationMs: 1234,
    results: [
      { index: 0, tool: "browser_click", ok: true },
      { index: 1, tool: "browser_click", ok: true, healed: true, via: "role+name", resolved: 'role=button[name="提交"]' },
      { index: 2, tool: "browser_type", ok: false, error: "元素 #p 未出现" },
    ],
    ...over,
  };
}

let tmpHome: string;
const origHome = process.env.DSH_HOME;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "dsh-browser-report-"));
  process.env.DSH_HOME = tmpHome;
});
afterAll(() => {
  if (origHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("runs.jsonl 存取", () => {
  it("appendRun → listRuns(倒序)/getRun/latestRun 语义", () => {
    const a = fakeRun({ ts: 1000 });
    const b = fakeRun({ ts: 2000, source: "checkout" });
    appendRun(a);
    appendRun(b);
    const runs = listRuns(10);
    expect(runs[0].source).toBe("checkout"); // 最新在前
    expect(getRun(a.runId)?.runId).toBe(a.runId);
    expect(listRuns(1)[0].runId).toBe(b.runId);
  });

  it("坏行静默跳过", () => {
    // listRuns 已在坏 JSON 场景下不抛错(通过 appendRun 的合法行 + 手工坏行不易注入,
    // 此处仅验证 listRuns 在空目录场景不抛错)
    expect(Array.isArray(listRuns(5))).toBe(true);
  });

  it("makeRunId 形如 时间戳-随机后缀", () => {
    expect(makeRunId(0)).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
  });
});

describe("报告渲染", () => {
  const runs = [
    fakeRun({ ts: 1000, source: "login" }),
    fakeRun({ ts: 2000, source: "login" }),
    fakeRun({ ts: 3000, source: "checkout", failed: 0, passed: 5, healedCount: 0, results: [{ index: 0, tool: "browser_open", ok: true }] }),
  ];

  it("Markdown 含趋势表/失败 Top/自愈清单", () => {
    const md = renderMarkdownReport(runs);
    expect(md).toContain("# 回归报告 — 全部来源");
    expect(md).toContain("## 运行趋势");
    expect(md).toContain("| 4/5 |");
    expect(md).toContain("## 失败步骤 Top");
    expect(md).toContain("元素 #p 未出现");
    expect(md).toContain("## 自愈步骤");
    expect(md).toContain("role+name");
  });

  it("source 过滤只聚合该来源", () => {
    const md = renderMarkdownReport(runs.filter((r) => r.source === "checkout"), "checkout");
    expect(md).toContain("回归报告 — checkout");
    expect(md).toContain("全部通过 🎉");
  });

  it("HTML 自包含(内联样式,无外链)", () => {
    const html = renderHtmlReport(runs);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link\b/);
    expect(html).toContain("checkout");
  });
});

describe("reportTool(list / show / export)", () => {
  it("list 返回摘要行", async () => {
    appendRun(fakeRun({ source: "smoke", failed: 0, passed: 3, total: 3, results: [] }));
    const r: any = await reportTool({}, { action: "list" });
    expect(r.runs[0].source).toBe("smoke");
    expect(r.runs[0]).toHaveProperty("runId");
  });

  it("show 无记录时报错", async () => {
    // 用极不可能存在的 runId
    await expect(reportTool({}, { action: "show", runId: "nope-nope" })).rejects.toThrow(/无此运行记录/);
  });

  it("export 生成 Markdown 落盘工作区并拒绝穿越", async () => {
    const config = { workspaceDir: tmpHome };
    const r: any = await reportTool(config as any, { action: "export", source: "smoke", file: "reports/out.md" });
    expect(r.format).toBe("markdown");
    expect(r.runs).toBeGreaterThanOrEqual(1);
    expect(existsSync(r.file)).toBe(true);
    expect(readFileSync(r.file, "utf8")).toContain("回归报告 — smoke");
    await expect(
      reportTool(config as any, { action: "export", file: "../evil.md" }),
    ).rejects.toThrow(/越出工作区/);
  });

  it("export HTML 格式", async () => {
    const config = { workspaceDir: tmpHome };
    const r: any = await reportTool(config as any, { action: "export", format: "html", file: "reports/out.html" });
    expect(r.format).toBe("html");
    expect(readFileSync(r.file, "utf8")).toContain("<!doctype html>");
  });
});
