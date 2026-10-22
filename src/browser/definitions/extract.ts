// dsh-browser · 浏览器工具定义 — extract
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import { extractTool } from "../tools.js";

export function getExtractTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_extract",
      description:
        "规则化结构化抽取(网站信息获取):fields 定义抽取结构 [{name, selector, attr?, multiple?, fields?}](attr 缺省取可见文本,可指定 href/src 等属性;multiple=true 收集所有命中;fields 嵌套可在行内抽子字段);next 传翻页选择器自动翻页聚合(maxPages 上限,next 消失/禁用即停);format 支持 json/csv/jsonl/markdown,file 落盘到工作区(自动按扩展名推断格式,拒绝路径穿越)。action:\"suggest\"(不传 fields)自动推断字段:从命中容器首条记录(表格首行/列表卡片)推断单元格文本/链接 href/图片 src 结构,返回建议 fields + 首行样本,确认/微调后直接交给抽取模式(往返 3-4 次降到 2 次);推断不出规律结构时返回原因与容器元素概览,不猜。语义化抽取(如「总结要点」)不在此工具范围——用 browser_snapshot 读文本后交 jev_extract。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["suggest"], description: "suggest:自动推断字段结构,返回建议 fields + 样本(此模式不传 fields)。" },
          scope: { type: "string", description: "suggest 模式的容器选择器(缺省整页;表格/列表探测在此范围内进行)。" },
          fields: {
            type: "array",
            items: { type: "object" },
            description: "抽取字段定义 [{name, selector, attr?, multiple?, fields?}](action:suggest 时不传)。",
          },
          next: { type: "string", description: "翻页「下一页」选择器(可选)。" },
          maxPages: { type: "integer", description: "翻页上限,默认 1,上限 100。" },
          waitAfterMs: { type: "integer", description: "翻页后等待毫秒,默认 800。" },
          maxRows: { type: "integer", description: "聚合行数上限,默认 1000。" },
          format: { type: "string", enum: ["json", "csv", "jsonl", "markdown"], description: "序列化格式(默认 json;file 有扩展名时自动推断)。" },
          file: { type: "string", description: "落盘路径(工作区相对或绝对,限工作区内)。" },
        },
        required: [],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string" },
          suggested: { type: "boolean" },
          kind: { type: "string" },
          rowSelector: { type: "string" },
          headerTexts: { type: "array", items: { type: "string" } },
          fields: { type: "array", items: { type: "object" } },
          sample: { type: "object" },
          reason: { type: "string" },
          overview: { type: "object" },
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
        required: ["url", "title"],
      },
      render: (_args, value) =>
        value.action === "suggest"
          ? value.suggested
            ? `字段建议(${value.kind}):行选择器 ${value.rowSelector},${value.fields[0].fields.length} 个字段;样例 ${JSON.stringify(value.sample).slice(0, 120)}`
            : `字段建议失败: ${String(value.reason).slice(0, 120)}`
          : `抽取 ${value.count} 行 / ${value.pages} 页${value.truncated ? "(已截断)" : ""}${value.file ? ` → ${value.file} (${value.bytes} bytes)` : ""}`,
      timeoutMs: timeout(),
      execute: (args, exec) => extractTool(config, args, exec),
    })
  ];
}
