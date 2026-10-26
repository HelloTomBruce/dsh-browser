// dsh-browser · 浏览器工具定义 — testing
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import { waitTool, waitForTool, assertTool, networkTool } from "../tools.js";

export function getTestingTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_wait",
      description: "等待指定毫秒数(上限 60000),常用于等待页面渲染或请求完成。",
      parameters: {
        type: "object",
        properties: {
          ms: { type: "integer", description: "等待毫秒数,默认 1000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          waitedMs: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["waitedMs", "url", "title"],
      },
      render: (_args, value) => `Waited ${value.waitedMs}ms`,
      timeoutMs: timeout(),
      execute: (args) => waitTool(config, args),
    }),
    definePlainTool({
      name: "browser_wait_for",
      description:
        "通用显式等待(测试同步原语):轮询直到条件成立或超时抛错。condition 格式(可放在 condition 对象内，也可直接平铺于顶层参数): 1) {selector:'#btn', state:'visible|hidden|attached|detached'}; 2) {ref:'e1', state}; 3) {row:'TASK-1002', action:'编辑', state}; 4) {url:'正则'}; 5) {text:'子串'}; 6) {count:{selector,op,value}}; 7) {eval:'JS 表达式' (支持纯表达式或 return 语句)}; 8) {bridge:{method:'桥方法名', args?:[], expect?:期望值 / expectContains:'子串'}} —— 页内调用 __DSH_BRIDGE__(vite-plugin-dsh-bridge)方法并断言返回(缺省判 truthy;expect 深比较),让桥取数与宿主等待无缝衔接。用于等页面渲染、等请求完成、等元素出现。",
      parameters: {
        type: "object",
        properties: {
          condition: {
            type: "object",
            description: "等待条件(见描述,五选一)。",
          },
          timeoutMs: { type: "integer", description: "超时毫秒,默认 10000,上限 120000。" },
          intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 500。" },
        },
        required: ["condition"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          met: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["met", "url", "title"],
      },
      render: (_args, value) => `等待条件满足: ${value.url}`,  
      timeoutMs: timeout(),
      execute: (args) => waitForTool(config, args),
    }),
    definePlainTool({
      name: "browser_assert",
      description:
        "结构化断言(测试核心):condition 在 timeoutMs 内成立则通过(条件格式同 browser_wait_for，支持 selector/ref/row+action/url/text/count/eval/bridge，亦可直接平铺在顶层参数)。bridge 条件 {bridge:{method,args?,expect?/expectContains?}} 页内调用 __DSH_BRIDGE__(vite-plugin-dsh-bridge)方法断言返回——桥取数、宿主断言留证(失败自动截图)。失败时自动截图存证据目录(assert-fail-*.png)并抛错,错误消息含原因与截图路径。另支持视觉回归:传 visual={baseline, threshold?, maxDiffRatio?, mask?} 与基线截图做像素比对(browser_screenshot 的 baseline 建立基线;mask 为忽略的选择器数组,如时钟/广告位),失败时产出当前截图与红标 diff 图。适合断言登录成功、关键元素出现、接口返回、文本正确、页面无视觉回归。",
      parameters: {
        type: "object",
        properties: {
          condition: { type: "object", description: "断言条件(同 browser_wait_for,另支持 {ref, state} 与 {bridge:{method,args?,expect?}})。" },
          visual: {
            type: "object",
            description: "视觉断言:{ baseline: 基线名, threshold?: 像素亮度阈值(默认0.1), maxDiffRatio?: 允许的差异像素比例(默认0.005), mask?: 忽略区域选择器数组 }。",
          },
          timeoutMs: { type: "integer", description: "断言超时毫秒,默认 5000,上限 60000。" },
          intervalMs: { type: "integer", description: "轮询间隔毫秒,默认 300。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          passed: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
          visual: { type: "object" },
        },
        required: ["passed", "url", "title"],
      },
      render: (_args, value) => `断言通过: ${value.url}`,  
      timeoutMs: timeout(),
      execute: (args, exec) => assertTool(config, args, exec),
    }),
    definePlainTool({
      name: "browser_network",
      description:
        "网络记录查询(自动记录页面 XHR/fetch 接口请求,含请求/响应体截断存储,每 profile 上限 500 条)。action:list 列出(可按 urlSubstr/method/status 过滤,limit 默认 50);failed 只列失败/4xx5xx;wait 等待某个 url 正则匹配的接口出现(带 timeoutMs,命中返回 waitMs);stats 按 host 聚合计数/失败数/平均耗时/状态码分布;clear 清空记录。适合断言接口出入参、排查 4xx/5xx。",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "failed", "wait", "stats", "clear"], description: "默认 list。" },
          urlSubstr: { type: "string", description: "URL 子串过滤(list/failed,大小写不敏感;零命中时附 suggestions 相近 URL 候选,防误判接口未调用)。" },
          method: { type: "string", description: "HTTP 方法过滤(list/failed)。" },
          status: { type: "integer", description: "状态码过滤(list/failed)。" },
          limit: { type: "integer", description: "返回条数上限,默认 50。" },
          url: { type: "string", description: "wait 时的 URL 正则。" },
          timeoutMs: { type: "integer", description: "wait 超时毫秒,默认 10000。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          entries: { type: "array", items: { type: "object" } },
          failed: { type: "array", items: { type: "object" } },
          stats: { type: "array", items: { type: "object" } },
          matched: { type: "object" },
          waitMs: { type: "integer" },
          cleared: { type: "boolean" },
          suggestions: { type: "array", items: { type: "string" }, description: "urlSubstr 零命中时的 top5 相近 URL 候选。" },
        },
        required: [],
      },
      render: (_args, value) => {
        if (value.cleared) return "网络记录已清空";
        if (value.stats) {
          return (value.stats as any[])
            .map((s) => `${s.host}  共${s.total} 失败${s.failed} 均耗时${s.avgMs ?? "-"}ms  ${JSON.stringify(s.byStatus)}`)
            .join("\n") || "(无记录)";
        }
        const list = value.entries ?? value.failed ?? (value.matched ? [value.matched] : []);
        return (list as any[])
          .map((e: any) => {
            const head = `${e.method} ${e.url} → ${e.failed ? "FAILED" : (e.ok ? e.status : e.status + " !")}${e.durationMs !== undefined ? ` ${e.durationMs}ms` : ""}`;
            const reqBody = e.postData ? `\n  req: ${String(e.postData).slice(0, 160)}` : "";
            const resBody = e.body ? `\n  res: ${String(e.body).slice(0, 240)}` : "";
            return head + reqBody + resBody;
          })
          .join("\n") || "(无记录)";
      },
      timeoutMs: timeout(),
      execute: (args) => networkTool(args),
    }),
  ];
}
