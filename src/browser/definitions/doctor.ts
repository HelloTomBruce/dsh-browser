// dsh-browser · 浏览器工具定义 — doctor
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import { doctorTool } from "../tools.js";

export function getDoctorTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_doctor",
      description:
        "浏览器环境健康诊断(不启动浏览器):检查可执行文件/channel、playwright-core 可用性、userDataDir 与截图/下载/基线目录写权限、工作区基准目录解析来源、当前会话状态、面板 API 可达性。环境异常(文件落错位置/浏览器起不来)时先跑本工具定位,每项失败检查附修复建议。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          checks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                ok: { type: "boolean" },
                detail: { type: "string" },
                advice: { type: "string" },
              },
              required: ["name", "ok", "detail"],
              additionalProperties: false,
            },
          },
          summary: {
            type: "object",
            properties: { ok: { type: "boolean" }, passed: { type: "integer" }, failed: { type: "integer" } },
            required: ["ok", "passed", "failed"],
            additionalProperties: false,
          },
        },
        required: ["checks", "summary"],
      },
      render: (_args, value) => {
        const lines = (value.checks as any[]).map(
          (c) => `${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}${c.advice ? `\n    建议: ${c.advice}` : ""}`,
        );
        return `诊断 ${value.summary.ok ? "通过" : "发现问题"}(${value.summary.passed}/${(value.checks as any[]).length})\n${lines.join("\n")}`;
      },
      timeoutMs: timeout(15_000),
      execute: (args, exec) => doctorTool(config, args, exec),
    })
  ];
}
