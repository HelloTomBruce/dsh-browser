// dsh-browser · 浏览器工具定义 — recorder
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import { recordTool, replayTool, batchTool, reportTool } from "../tools.js";

export function getRecorderTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_record",
      description:
        "操作录制(回归测试数据源):start 开始录制(后续浏览器工具调用自动记录,selector 步骤附带元素指纹),stop 结束并返回步数,save <name> 保存(start→stop 的录制 buffer 优先,否则取最近 100 次调用;stripReads=true 剔除只读探查步骤;vars 可把指定步骤字段抽成 {{占位符}} 实现参数化回放;upload 引用的本地文件缺失时返回 warnings),list/delete 管理。配合 browser_replay 一键回放。",
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
        if (args.action === "start") return "开始录制(后续浏览器调用将记录)";
        if (args.action === "stop") return `录制结束,共 ${value.steps} 步(browser_record save <name> 保存)`;
        if (args.action === "save") {
          const warn = (value.warnings ?? []).length > 0 ? `\n⚠️ ${(value.warnings as string[]).join("\n⚠️ ")}` : "";
          const stripped = typeof value.stripped === "number" ? `(已剔除 ${value.stripped} 个只读步骤)` : "";
          const vars = typeof value.varsApplied === "number" ? `(参数化 ${value.varsApplied} 个变量)` : "";
          return `已保存录制 "${value.saved}"(${value.steps} 步,来源: ${value.source === "recording" ? "start→stop 录制" : "最近操作轨迹"})${stripped}${vars}${warn}`;
        }
        if (args.action === "delete") return value.deleted ? `已删除 "${value.name}"` : `无此录制 "${value.name}"`;
        return (value.recordings ?? []).map((r: any) => `"${r.name}"(${r.steps} 步): ${r.preview}`).join("\n") || "(无录制)";
      },
      timeoutMs: timeout(),
      execute: (args) => recordTool(args),
    }),
    definePlainTool({
      name: "browser_replay",
      description:
        "回放录制或步骤序列(回归测试):name 指定已保存录制(browser_record save),或直接传 steps 数组(每步 {tool, args})。failFast 默认 true(遇错停止);返回每步结果与汇总。选择器自愈:录制时保存了元素指纹的步骤,原 selector 失败时自动按 testid→role+name→text→id 降级重试并在结果中标 healed(建议事后修复录制选择器)。参数化:录制含 {{占位符}} 时用 vars 注入;data 传对象数组或 dataFile 传 CSV 路径(首行为变量名)可逐行数据驱动回放。retryFailed: N 使失败步骤(自愈链耗尽后)自动重试 N 次(500ms×n 线性退避,重试耗尽才停),返回值 retries 标注 { attempted, recovered }。运行结果自动记入回归历史(browser_report 可导出报告)。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "已保存录制名(与 steps 二选一)。" },
          steps: { type: "array", items: { type: "object" }, description: "步骤数组 [{tool, args}](可含 meta.hint 指纹)。" },
          failFast: { type: "boolean", description: "遇错即停,默认 true(data 模式为行内 failFast,不中断后续行)。" },
          vars: { type: "object", description: "{{占位符}} 的注入值,如 { username: \"a@x.com\" }。" },
          data: { type: "array", items: { type: "object" }, description: "数据集:每行一个对象,逐行回放一次。" },
          dataFile: { type: "string", description: "数据集 CSV 文件(工作区相对路径,首行为变量名)。" },
          retryFailed: { type: "integer", description: "失败步骤自动重试次数(0-10,默认 0;500ms×n 线性退避,重试耗尽才停)。偶发超时/网络抖动类失败的兜底。" },
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
          retries: { type: "object", description: "自动重试统计 { attempted, recovered }(仅 retryFailed>0 时返回)。" },
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
          ? `${value.summary}\n${(value.runs as any[]).map((r: any) => `${(r.failed ?? 0) === 0 ? "✓" : "✗"} 行${r.row}${r.error ? ` — ${String(r.error).slice(0, 100)}` : ` ${r.passed}/${r.total}`}`).join("\n")}`
          : `${value.summary}\n${(value.results ?? []).map((r: any) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.healed ? ` [自愈:${r.via}]` : ""}${r.recovered ? " [重试挽回]" : ""}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`;
        return rowsInfo;
      },
      timeoutMs: timeout(600_000),
      execute: (args, exec) => replayTool(args, stepImpls, config, exec),
    }),
    definePlainTool({
      name: "browser_batch",
      description:
        "动作批处理:一次调用顺序执行多个浏览器步骤 [{tool, args}](内核同 browser_replay),减少「点击→等待→输入→回车」类固定小序列的往返。failFast 默认 true(遇错停);步骤内禁止嵌套 browser_batch/browser_replay/browser_record;批整体在操作轨迹/录制里记为单条步骤(可录制、可回放)。",
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
      render: (_args, value) => `${value.summary}\n${(value.results ?? []).map((r: any) => `${r.ok ? "✓" : "✗"} #${r.index} ${r.tool}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n")}`,
      timeoutMs: timeout(600_000),
      execute: (args) => batchTool(args, stepImpls),
    }),
    definePlainTool({
      name: "browser_report",
      description:
        "回归运行报告:每次 browser_replay / browser_batch 的结果自动记入运行历史。action=list 列出最近运行;show 查看单条详情(runId 省略取最近一条);export 聚合生成报告落盘工作区(format=markdown|html,含运行趋势、失败步骤 Top、自愈步骤清单,source 可只看某个录制)。配合 DSH 的 schedule 能力可实现定时回归+定期报告。",
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
          .map((r: any) => `${r.failed === 0 ? "✓" : "✗"} ${new Date(r.ts).toLocaleString("zh-CN", { hour12: false })} ${r.source}${r.row !== undefined ? ` 行${r.row}` : ""}: ${r.passed}/${r.total}${r.healedCount > 0 ? ` (自愈${r.healedCount})` : ""}`)
          .join("\n") || "(暂无运行记录)";
      },
      timeoutMs: timeout(),
      execute: (args, exec) => reportTool(config, args, exec),
    })
  ];
}
