// dsh-browser · 工具使用指引文案(单一来源)
//
// DSH 插件入口把它注册进 systemPrompt 段落;独立 MCP 入口把它作为
// server instructions 下发。两版全文(toolset all/core)+ confirmMode
// 附加指引的拼接逻辑都在这里,文案变更只动这一处。

import type { BrowserConfig } from "../browser/types.js";

const FULL_TOOL_PROMPT =
  "浏览器工具操作一个共享浏览器会话,支持多标签页与多配置文件。定位操作元素最省事的方式是意图语义定位:browser_click/browser_type/browser_select 直接传 what(元素名称/label,如 what:'登录'),页内打分匹配并自动注册 ref,一次调用替代 快照→查找→点击 三轮;零命中报错会附最相近候选。需要精确控制时再用 selector(CSS)/ref(aria 快照)。打开页面后可先 browser_snapshot 读文本与链接、browser_elements 读表单结构(含关联 label 与展开的下拉选项);browser_find(query 传名称,只返回命中 ref+区域上下文,大页面最省 token;零命中会给相近候选)适合多目标排查,需要全页结构时再用 browser_snapshot { mode: \"aria\" }(可交互元素带 ref=eN,click/type/select/press 直接传 ref 代替 CSS 选择器);下拉选择(原生 select 与 antd/element 组件库)用 browser_select 传 selector/ref/what + option 文本一步完成;固定小序列(点击→等待→输入→提交)用 browser_batch 一次执行减少往返;标签管理用 browser_tabs;下载用 browser_download(wait=true 可等新下载);登录态用 browser_cookies。做自动化测试时:用 browser_wait_for 显式等待页面稳定/元素出现,用 browser_assert 断言(失败自动截图;visual={baseline} 可做视觉回归,先用 browser_screenshot { baseline } 建基线),用 browser_network 检查接口调用与 4xx/5xx,跑完一轮可用 browser_record save 保存操作序列、browser_replay 回放做回归(选择器失效自动按指纹自愈;vars/data 支持参数化与数据驱动)。每次 replay/batch 都记入运行历史,browser_report list/export 可查看与导出回归报告。抓取结构化数据用 browser_extract(fields 定义 CSS 字段,可翻页,可导出 CSV/JSONL)。遇到需要登录的网站:先 browser_open 打开登录页,告知用户请在浏览器窗口中完成登录,再调用 browser_wait_for_login 等待(可给 successSelector/successUrl);验证码/二次确认等更广的「人补一步」场景用 browser_pause_for_human(提示语会显示在实时画面面板);配置 userDataDir 时登录态会持久化。用户可通过界面右下角面板的实时画面查看浏览器。";

const CORE_TOOL_PROMPT =
  "浏览器工具操作一个共享浏览器会话(toolset=core:已精简工具集)。定位操作元素最省事的方式是意图语义定位:browser_click/browser_type/browser_select 直接传 what(元素名称/label,如 what:'登录'),一次调用替代快照→查找→点击;零命中报错附最相近候选。需要精确控制时再用 selector/ref:打开页面后用 browser_snapshot 读内容(scope 限定区域、since 增量重读省 token),browser_find(query 传名称,返回 ref),点击/输入/按键/下拉用 browser_click/browser_type/browser_press/browser_select(selector 或 ref);固定小序列用 browser_batch;等待用 browser_wait/browser_wait_for,断言用 browser_assert;接口检查用 browser_network;标签 browser_tabs;下载/上传 browser_download/browser_upload。需要人工:登录用 browser_wait_for_login,验证码/二次确认用 browser_pause_for_human,敏感动作(提交/删除/支付)前用 browser_confirm。环境异常先跑 browser_doctor 诊断。录制/回放/报告/抽取/profile/隔离 context 等工具当前未注册(toolset=core),需要时把配置改为 toolset: all 并重启 DSH。用户可通过界面右下角面板的实时画面查看浏览器。";

/** confirmMode 附加指引(与 DSH 入口同款语义,manual 面向宿主审批、auto 说明硬闸)。 */
function confirmGuidanceOf(confirmMode: string | undefined): string {
  if (confirmMode === "manual") {
    return "本环境 confirmMode 为 manual:凡提交/删除/支付等不可逆或影响线上数据的敏感动作,执行前必须先调用 browser_confirm(reason 说明操作与影响,等待用户在实时画面面板点允许/拒绝;拒绝或超时即放弃该动作,不得换路径绕过)。";
  }
  if (confirmMode === "auto") {
    return "本环境 confirmMode 为 auto:宿主层已在敏感动作(命中敏感模式的目标元素)前强制弹审批卡,agent 无法绕过;审批被拒绝或超时的动作不可换路径重试,应向用户说明并等待指示。";
  }
  return "";
}

/** 组装完整的工具使用指引文本(DSH systemPrompt 段落与 MCP instructions 共用)。 */
export function browserSystemPrompt(config: Pick<BrowserConfig, "toolset" | "confirmMode">): string {
  const base = config.toolset === "core" ? CORE_TOOL_PROMPT : FULL_TOOL_PROMPT;
  return base + confirmGuidanceOf(config.confirmMode);
}

export { FULL_TOOL_PROMPT, CORE_TOOL_PROMPT };
