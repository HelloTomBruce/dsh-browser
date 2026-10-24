// dsh-browser · 浏览器工具定义 — collaboration
import type { PlainToolDefinition } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { definePlainTool, genericCard } from "../../lib/tools.js";
import { waitForLoginTool, pauseForHumanTool, confirmTool, pickTool } from "../tools.js";

export function getCollaborationTools(
  config: BrowserConfig,
  timeout: (ms?: number) => number,
  stepImpls?: Record<string, (a: any) => Promise<unknown>>,
): PlainToolDefinition[] {
  return [
    definePlainTool({
      name: "browser_wait_for_login",
      description:
        "等待人工登录完成。agent 在登录页调用本工具后,提示用户在浏览器窗口中完成登录(有头模式 headless:false 时用户可直接操作;配 userDataDir 登录态会持久化)。成功条件三选一:successSelector(登录后出现的元素,如 '#avatar')或 successUrl(登录后 URL 正则,如 'https://\\\\.app\\\\.example\\\\.com')都不给则 URL 发生变化即视为完成。轮询间隔 2 秒,超时返回 loggedIn:false。",
      parameters: {
        type: "object",
        properties: {
          timeoutMs: { type: "integer", description: "等待上限(毫秒,默认 120000,上限 600000)。" },
          successSelector: { type: "string", description: "登录成功后应出现的 CSS 选择器。" },
          successUrl: { type: "string", description: "登录成功后 URL 应匹配的正则。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          loggedIn: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["loggedIn", "url", "title"],
      },
      render: (_args, value) =>
        value.loggedIn ? `登录完成: ${value.url}` : `等待登录超时,仍在: ${value.url}`,
      timeoutMs: timeout(600_000),
      execute: (args) => waitForLoginTool(config, args),
    }),
    definePlainTool({
      name: "browser_pause_for_human",
      description:
        "人工接管等待:agent 把控制权暂时交还给用户,适用于验证码/短信确认/二次复核/敏感步骤人工兜底等场景。调用后提示(instruction)会显示在界面右下角实时画面面板,等待用户在浏览器窗口中完成操作。完成条件三选一:successSelector(完成后出现的元素)、successUrl(完成后 URL 匹配的正则),都不给则 URL 或页面内容发生变化即视为完成。轮询间隔 2 秒;超时不抛错,返回 completed:false,agent 可再次调用或改走其他路径。",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "给用户看的提示语,如「请在浏览器中输入短信验证码」。" },
          timeoutMs: { type: "integer", description: "等待上限(毫秒,默认 300000,下限 1000,上限 600000)。" },
          successSelector: { type: "string", description: "完成后应出现的 CSS 选择器。" },
          successUrl: { type: "string", description: "完成后 URL 应匹配的正则。" },
        },
        required: ["instruction"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          completed: { type: "boolean" },
          status: { type: "string", enum: ["completed", "timedOut"] },
          instruction: { type: "string" },
          detail: { type: "string" },
          waitedMs: { type: "integer" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["completed", "status", "instruction", "detail", "waitedMs", "url", "title"],
      },
      render: (_args, value) =>
        value.completed
          ? `人工操作完成(${value.waitedMs}ms): ${value.url}`
          : `等待人工操作超时(${value.waitedMs}ms): ${value.instruction} — ${value.detail}`,
      timeoutMs: timeout(600_000),
      execute: (args) => pauseForHumanTool(config, args),
    }),
    definePlainTool({
      name: "browser_confirm",
      description:
        "敏感操作审批:在执行提交/删除/支付等不可逆或影响线上数据的动作前调用,审批请求(含 reason 与将执行的操作)会推送到界面右下角实时画面面板,等待用户点「允许/拒绝」。用户允许时返回 decision:'allowed';用户拒绝或等待超时(默认 60s,fail-closed)**抛错**,live 调用与 replay/batch 步骤统一按失败处理。confirmMode:'manual' 时 systemPrompt 会要求所有敏感动作前必须先过本工具。",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "给用户看的审批理由:要执行什么操作、影响是什么。" },
          tool: { type: "string", description: "可选:即将执行的工具名,如 'browser_click'。" },
          args: { type: "object", description: "可选:即将执行的工具参数(如 { selector: '#submit' }),供面板展示。" },
          timeoutMs: { type: "integer", description: "等待决策上限(毫秒,默认取配置 confirmTimeoutMs=60000,下限 1000,上限 600000)。" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: { type: "string", enum: ["allowed"] },
          id: { type: "string" },
          reason: { type: "string" },
          waitedMs: { type: "integer" },
          detail: { type: "string" },
        },
        required: ["decision", "id", "reason", "waitedMs", "detail"],
      },
      render: (_args, value) => `用户允许执行(${value.waitedMs}ms): ${value.reason}`,
      timeoutMs: timeout(600_000),
      execute: (args) => confirmTool(config, args),
    }),
    definePlainTool({
      name: "browser_pick_element",
      description:
        "面板点选教学:一句话说不清/定位反复失败的疑难元素(画布、CSS-in-JS 哈希类名、深层 Shadow DOM),调用本工具后实时画面面板大图会显示十字光标,等用户在画面上点一下目标元素,即返回该元素的稳定 selector、选择器指纹(可进录制自愈)与可直接使用的 ref。超时不抛错,返回 picked:false。适合定位失败 2 次后改走人工指路,比继续猜选择器更高效。",
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "给用户看的提示语,默认「请在实时画面大图上点击要教学的目标元素」。" },
          timeoutMs: { type: "integer", description: "等待点选上限(毫秒,默认 300000,下限 1000,上限 600000)。" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          picked: { type: "boolean" },
          status: { type: "string", enum: ["picked", "timedOut", "missed"] },
          instruction: { type: "string" },
          detail: { type: "string" },
          waitedMs: { type: "integer" },
          ref: { type: "string" },
          selector: { type: "string" },
          role: { type: "string" },
          name: { type: "string" },
          tag: { type: "string" },
          testid: { type: "string" },
          elementId: { type: "string" },
          text: { type: "string" },
          hint: { type: "object" },
          x: { type: "integer" },
          y: { type: "integer" },
          map: { type: "object", description: "坐标换算诊断:viewport(基准)/img(面板上报位图)/cdpFrame(捕获帧 dims,可能小于 viewport)/pageScaleFactor。" },
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["picked", "status", "instruction", "detail", "waitedMs"],
      },
      render: (_args, value) =>
        value.picked
          ? `用户点选: ${value.role} "${value.name}" → ${value.selector}${value.ref ? ` [ref=${value.ref}]` : ""}`
          : `未完成点选(${value.status}): ${value.detail}`,
      timeoutMs: timeout(600_000),
      execute: (args) => pickTool(config, args),
    }),
  ];
}
