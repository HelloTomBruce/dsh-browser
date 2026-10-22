// dsh-browser · 浏览器工具定义 — interaction
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import {
  clickTool, typeTool, pressTool, selectTool, evalTool,
  downloadTool, uploadTool, cookiesTool, formTool, formSaveTool, formsTool, formFillTool,
} from "../tools.js";

export function getInteractionTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_click",
      description: "点击页面元素:selector(CSS)或 ref(来自 browser_snapshot mode:'aria')二选一。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS 选择器。" },
          ref: { type: "string", description: "aria 快照的 ref(如 'e3');导航后失效。" },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          clicked: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["clicked", "url", "title"],
      },
      render: (_args, value) => `Clicked ${value.clicked}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => clickTool(config, args),
    }),
    definePlainTool({
      name: "browser_type",
      description:
        "向输入框输入文本:selector(CSS)或 ref 二选一。clear=true 时先清空再输入(推荐用于表单);submit=true 时输入后按回车。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string" },
          ref: { type: "string", description: "aria 快照的 ref(如 'e2')。" },
          text: { type: "string" },
          clear: { type: "boolean" },
          submit: { type: "boolean" },
          delayMs: { type: "integer" },
          timeoutMs: { type: "integer" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          typed: { type: "boolean" },
          selector: { type: "string" },
          submit: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["typed", "selector", "submit", "url", "title"],
      },
      render: (_args, value) =>
        `Typed into ${value.selector}${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => typeTool(config, args),
    }),
    definePlainTool({
      name: "browser_press",
      description:
        "按键:有 selector 或 ref 时先聚焦该元素再按键(如 'Enter'、'Tab'、'Escape'、'Control+a'),否则在页面级按键。",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "按键名(Playwright 键盘键名)。" },
          selector: { type: "string" },
          ref: { type: "string", description: "aria 快照的 ref。" },
          timeoutMs: { type: "integer" },
        },
        required: ["key"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          pressed: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["pressed", "url", "title"],
      },
      render: (_args, value) => `Pressed ${value.pressed}`,
      timeoutMs: timeout(),
      execute: (args) => pressTool(config, args),
    }),
    definePlainTool({
      name: "browser_select",
      description:
        "下拉选择原语:原生 <select> 与组件库下拉(antd / element-plus / ARIA listbox)通用。selector 或 ref 指向下拉触发框,option 为选项文本(默认包含匹配,exact=true 精确)。找不到选项时报错并列出可见选项,无需再 browser_eval 探查。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "下拉触发框的 CSS 选择器(如 #rc_select_1)。" },
          ref: { type: "string", description: "aria 快照的 ref。" },
          option: { type: "string", description: "要选择的选项文本。" },
          exact: { type: "boolean", description: "精确匹配,默认 false(包含匹配)。" },
          timeoutMs: { type: "integer" },
        },
        required: ["option"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          selected: { type: "string" },
          selector: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["selected", "selector", "url", "title"],
      },
      render: (_args, value) => `Selected "${value.selected}" in ${value.selector}`,
      timeoutMs: timeout(),
      execute: (args) => selectTool(config, args),
    }),
    definePlainTool({
      name: "browser_eval",
      description:
        "在页面上下文执行一段 JavaScript。表达式直接求值(如 'document.title');含换行/分号的语句会被包进 async IIFE,可用 return 返回。结果必须是可 JSON 序列化的值。",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "要执行的 JavaScript。" },
        },
        required: ["script"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          result: {},
          scriptUnwrapped: { type: "boolean", description: "入参 script 疑似被 JSON 双重序列化(以引号包裹且含 \\n 字面量),已自动解码一层。" },
        },
        required: ["result"],
      },
      render: (_args, value) => `Result: ${JSON.stringify(value.result)}`,
      timeoutMs: timeout(),
      execute: (args) => evalTool(config, args),
    }),
    definePlainTool({
      name: "browser_download",
      description:
        "获取页面上最近触发的下载(如点击下载链接后),保存到工作区 .dsh-browser/downloads/ 并返回路径。index 可选,默认最近一次;wait=true 时先轮询等待新下载出现(以调用时刻为基线,默认等 10 秒),避免 browser_wait 盲等;浏览器会话关闭后下载记录丢失。",
      parameters: {
        type: "object",
        properties: {
          index: { type: "integer", description: "下载记录序号(0 起,默认最近)。" },
          wait: { type: "boolean", description: "等待新下载出现再取,默认 false。" },
          timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000,上限 60000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          filename: { type: "string" },
          url: { type: "string" },
          bytes: { type: "integer" },
        },
        required: ["path", "filename", "url", "bytes"],
      },
      render: (_args, value) => `Downloaded ${value.filename} (${value.bytes} bytes) → ${value.path}`,
      timeoutMs: timeout(),
      execute: (args, exec) => downloadTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_upload",
      description:
        "把本地文件上传到页面的文件输入框(selector 指向 input[type=file])。path 可以是绝对路径或相对工作区的路径。",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "文件输入框的 CSS 选择器。" },
          path: { type: "string", description: "要上传的文件路径。" },
          timeoutMs: { type: "integer" },
        },
        required: ["selector", "path"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          uploaded: { type: "string" },
          bytes: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["uploaded", "bytes", "url", "title"],
      },
      render: (args, value) => `Uploaded ${value.uploaded} (${value.bytes} bytes) to ${args.selector}`,
      timeoutMs: timeout(),
      execute: (args, exec) => uploadTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_cookies",
      description:
        "管理浏览器 Cookie:list 列出当前页面域名的 Cookie(默认隐藏值,showValues=true 显示),set 设置一个 Cookie(可指定 url,默认当前页面),clear 清空全部。用于处理登录态。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "set", "clear"] },
          url: { type: "string", description: "list 的过滤域名或 set 的归属 URL。" },
          name: { type: "string", description: "set 时的 Cookie 名。" },
          value: { type: "string", description: "set 时的 Cookie 值。" },
          showValues: { type: "boolean" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          cookies: { type: "array", items: { type: "object" } },
          set: { type: "boolean" },
          cleared: { type: "boolean" },
          name: { type: "string" },
          url: { type: "string" },
        },
        required: [],
      },
      render: (_args, value) => {
        if (value.cleared) return "All cookies cleared";
        if (value.set) return `Cookie ${value.name} set for ${value.url}`;
        return (value.cookies ?? [])
          .map((c: any) => `${c.name}=${c.value} (${c.domain}${c.path}, httpOnly=${c.httpOnly})`)
          .join("\n") || "(no cookies)";
      },
      timeoutMs: timeout(),
      execute: (args) => cookiesTool(config, args),
    }),
    definePlainTool({
      name: "browser_form",
      description:
        "批量填充表单:fields 数组,每项给 selector(CSS)或 label(可见文本)与 value;submit=true 时填完按回车提交。也可 from=<已保存表单名> 回放(browser_form_save 保存)。先 browser_elements 或 browser_snapshot 了解表单结构。",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                selector: { type: "string" },
                label: { type: "string" },
                value: { type: "string" },
              },
            },
            description: "要填充的字段列表(from 回放时省略)。",
          },
          from: { type: "string", description: "回放已保存表单的名称。" },
          submit: { type: "boolean" },
          timeoutMs: { type: "integer" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filled: { type: "array", items: { type: "object" } },
          submit: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["filled", "submit", "url", "title"],
      },
      render: (args, value) =>
        `Filled ${value.filled.length} field(s)${value.submit ? " and submitted" : ""}\nNow at: ${value.url}`,
      timeoutMs: timeout(),
      execute: (args) => formTool(config, args),
    }),
    definePlainTool({
      name: "browser_form_save",
      description:
        "把最近一次 browser_form 填充的字段保存为命名表单(或直接传 fields),之后 browser_form 用 from=<name> 一键回放。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "表单名(回放时用)。" },
          fields: { type: "array", items: { type: "object" }, description: "可选,不传则用最近一次填充。" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          saved: { type: "string" },
          fields: { type: "integer" },
        },
        required: ["saved", "fields"],
      },
      render: (_args, value) => `Saved form "${value.saved}" with ${value.fields} field(s)`,
      timeoutMs: timeout(),
      execute: (args) => formSaveTool(args),
    }),
    definePlainTool({
      name: "browser_forms",
      description: "管理已保存的表单回放:list 列出,delete 删除指定表单。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "delete"] },
          name: { type: "string", description: "delete 时的表单名。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          forms: { type: "array", items: { type: "object" } },
          deleted: { type: "boolean" },
          name: { type: "string" },
        },
        required: [],
      },
      render: (args, value) => {
        if (args.action === "delete") return value.deleted ? `Deleted "${value.name}"` : `No form "${value.name}"`;
        return (value.forms ?? [])
          .map((f: any) => `"${f.name}" (${f.fields} fields): ${f.preview}`)
          .join("\n") || "(no saved forms)";
      },
      timeoutMs: timeout(),
      execute: (args) => formsTool(args),
    }),
    definePlainTool({
      name: "browser_form_fill",
      description: "智能批量表单填写: 一次调用自动识别并填充多个表单控件, 结合 UI 适配器自动处理输入/选择与弹层。",
      parameters: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            description: "表单键值对映射(键支持 label/placeholder/selector, 值为待填内容)",
          },
          scope: {
            type: "string",
            description: "可选容器选择器, 限制填充范围",
          },
          submitButton: {
            type: "string",
            description: "可选, 填写完成后自动点击的提交按钮名称或选择器",
          },
          timeoutMs: { type: "integer" },
        },
        required: ["fields"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          filled: { type: "array", items: { type: "string" } },
          skipped: { type: "array", items: { type: "string" } },
          errors: { type: "object" },
          submitted: { type: "boolean" },
        },
        required: ["filled", "skipped", "errors"],
      },
      render: (_args, value) =>
        `Filled ${value.filled.length} fields: ${value.filled.join(", ")}${value.skipped.length > 0 ? ` (skipped: ${value.skipped.join(", ")})` : ""}${value.submitted ? " [Submitted]" : ""}`,
      timeoutMs: timeout(),
      execute: (args) => formFillTool(config, args),
    }),
  ];
}
