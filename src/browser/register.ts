// dsh-browser · 浏览器 — 工具注册 (模块化组装)
import type { ReefContext, PlainToolDefinition, ToolRunContext } from "../lib/types.js";
import type { BrowserConfig } from "./types.js";
import { setToolsLogger } from "../lib/tools.js";
import { recordCall, isRecording, activePage, noteAgentAction, pageRef, noteToolStart, noteToolEnd, currentProfile } from "./session.js";
import { sessionTracer } from "./session/tracer.js";
import {
  openTool, snapshotTool, clickTool, typeTool, pressTool, selectTool, evalTool,
  screenshotTool, waitTool, backTool, reloadTool,
  statusTool, closeTool, tabsTool, downloadTool, uploadTool, cookiesTool, formTool, formSaveTool, formsTool, profileTool, contextTool, doctorTool,
  elementsTool, waitForLoginTool, pauseForHumanTool, confirmTool, pickTool,
  findTool, waitForTool, assertTool, networkTool, recordTool, replayTool, batchTool, extractTool, formFillTool,
  captureSelectorHint, SELECTOR_STEP_TOOLS, previewHighlight,
  confirmGate, setRerunHandler,
} from "./tools.js";

import { getNavigationTools } from "./definitions/navigation.js";
import { getInteractionTools } from "./definitions/interaction.js";
import { getInspectionTools } from "./definitions/inspection.js";
import { getTestingTools } from "./definitions/testing.js";
import { getCollaborationTools } from "./definitions/collaboration.js";
import { getDoctorTools } from "./definitions/doctor.js";
import { getRecorderTools } from "./definitions/recorder.js";
import { getExtractTools } from "./definitions/extract.js";

export function registerTools(ctx: ReefContext, config: BrowserConfig) {
  const tools =
    ctx.get<{ register(definition: PlainToolDefinition): unknown }>("tools") ?? (ctx as any).tools;
  if (tools === undefined) return;
  setToolsLogger((m) => ctx.logger?.info?.(m));
  const timeout = (ms?: number) => ms ?? config.timeoutMs ?? 30000;

  /** 会触发真实 DOM 事件的 agent 工具:执行前后打点,混合录制时用于区分人手与工具回声。 */
  const AGENT_DOM_TOOLS = new Set([
    "browser_click", "browser_type", "browser_select", "browser_press",
    "browser_upload", "browser_form", "browser_form_fill", "browser_eval",
  ]);

  /** 操作预告:这些工具执行前把目标元素在实时画面上高亮(异步不阻塞)。 */
  const PREVIEW_TOOLS = new Set(["browser_click", "browser_type", "browser_select", "browser_press"]);

  /**
   * auto 审批闸(confirmMode:"auto" 硬约束):live 调用在 register 包装层拦,
   * replay/batch 在 stepImpls 外再包一层(默认同样拦截;confirmInReplay: false
   * 可关,README 注明风险)。未命中模式时闸内只花一次页内 evaluate。
   */
  const replayGate = (tool: string, fn: (a: any) => Promise<unknown>) => async (a: any) => {
    if (
      (config.confirmMode === "auto" || (config.confirmPolicies && config.confirmPolicies.length > 0)) &&
      config.confirmInReplay !== false
    ) {
      await confirmGate(config, tool, a);
    }
    return fn(a);
  };

  /**
   * toolset: "core" 的高频核心集:浏览/定位/操作/等待/断言/人机协作。
   * 低频的录制/回放/报告/抽取/表单回放/profile/context 等只在 "all" 注册。
   */
  const CORE_TOOLS = new Set([
    "browser_open", "browser_snapshot", "browser_find", "browser_elements",
    "browser_click", "browser_type", "browser_press", "browser_select",
    "browser_eval", "browser_batch", "browser_wait", "browser_wait_for",
    "browser_assert", "browser_screenshot", "browser_wait_for_login",
    "browser_pause_for_human", "browser_confirm", "browser_pick_element", "browser_network",
    "browser_tabs", "browser_download", "browser_upload", "browser_status",
    "browser_doctor", "browser_close",
  ]);

  /** 打点包装:每次工具调用记录操作轨迹(测试报告 / 录制数据源)。 */
  function register(def: PlainToolDefinition) {
    if (config.toolset === "core" && !CORE_TOOLS.has(def.name)) return;
    const original = def.execute;
    def.execute = async (args: any, exec: ToolRunContext) => {
      const t0 = Date.now();
      noteToolStart();
      const domTool = AGENT_DOM_TOOLS.has(def.name);
      if (domTool) noteAgentAction();
      if (config.confirmMode === "auto" || (config.confirmPolicies && config.confirmPolicies.length > 0)) {
        await confirmGate(config, def.name, args);
      }
      sessionTracer.startStep(currentProfile, def.name, args, activePage());
      if (PREVIEW_TOOLS.has(def.name)) {
        const page = activePage();
        const selector =
          typeof args?.selector === "string" && args.selector
            ? args.selector
            : typeof args?.ref === "string" && args.ref && page !== null
              ? (pageRef(page, args.ref)?.selector ?? "")
              : "";
        if (selector !== "") {
          const label = `${def.name.replace(/^browser_/, "")} ${args?.ref ? `[${args.ref}] ` : ""}${args?.key ?? args?.value ?? args?.text ?? ""}`.trim();
          previewHighlight(page, selector, label);
        }
      }
      try {
        const result = await original(args, exec);
        void sessionTracer.endStep(currentProfile, true, undefined, activePage());
        const call = recordCall({ tool: def.name, args, ok: true, ms: Date.now() - t0, ts: Date.now() });
        if (isRecording() && SELECTOR_STEP_TOOLS.has(def.name) && typeof args?.selector === "string") {
          const page = activePage();
          if (page !== null) {
            const hintResult = await captureSelectorHint(page, String(args.selector));
            if (hintResult !== null) call.meta = { hint: hintResult };
          }
        }
        return result;
      } catch (error) {
        void sessionTracer.endStep(
          currentProfile,
          false,
          error instanceof Error ? error.message : String(error),
          activePage(),
        );
        recordCall({
          tool: def.name,
          args,
          ok: false,
          ms: Date.now() - t0,
          ts: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        if (domTool) noteAgentAction();
        noteToolEnd();
      }
    };
    tools!.register(def);
  }

  // 基础执行器映射(供 replay 与 batch 回放用)
  const stepImpls: Record<string, (args: any) => Promise<unknown>> = {
    browser_open: (a) => openTool(config, a),
    browser_snapshot: (a) => snapshotTool(config, a),
    browser_click: (a) => clickTool(config, a),
    browser_type: (a) => typeTool(config, a),
    browser_press: (a) => pressTool(config, a),
    browser_select: (a) => selectTool(config, a),
    browser_eval: (a) => evalTool(config, a),
    browser_screenshot: (a) => screenshotTool(config, a),
    browser_wait: (a) => waitTool(config, a),
    browser_back: () => backTool(config),
    browser_reload: () => reloadTool(config),
    browser_status: () => statusTool(),
    browser_close: () => closeTool(),
    browser_tabs: (a) => tabsTool(config, a),
    browser_download: (a) => downloadTool(config, a),
    browser_upload: (a) => uploadTool(config, a),
    browser_cookies: (a) => cookiesTool(config, a),
    browser_form: (a) => formTool(config, a),
    browser_form_save: (a) => formSaveTool(a),
    browser_forms: (a) => formsTool(a),
    browser_form_fill: (a) => formFillTool(config, a),
    browser_profile: (a) => profileTool(config, a),
    browser_elements: (a) => elementsTool(config, a),
    browser_wait_for_login: (a) => waitForLoginTool(config, a),
    browser_pause_for_human: (a) => pauseForHumanTool(config, a),
    browser_confirm: (a) => confirmTool(config, a),
    browser_pick_element: (a) => pickTool(config, a),
    browser_find: (a) => findTool(config, a),
    browser_doctor: (a) => doctorTool(config, a, undefined),
    browser_context: (a) => contextTool(config, a),
    browser_wait_for: (a) => waitForTool(config, a),
    browser_assert: (a) => assertTool(config, a, undefined as any),
    browser_network: (a) => networkTool(a),
    browser_record: (a) => recordTool(a),
    browser_replay: (a) => replayTool(a, stepImpls, config),
    browser_batch: (a) => batchTool(a, stepImpls, config),
    browser_extract: (a) => extractTool(config, a),
  };

  for (const name of Object.keys(stepImpls)) {
    const fn = stepImpls[name]!;
    stepImpls[name] = replayGate(name, fn);
  }

  setRerunHandler((req) =>
    replayTool({ name: req.source, ...(req.retryOf !== undefined ? { retryOf: req.retryOf } : {}) }, stepImpls, config),
  );

  // 领域定义组装
  const toolFactories = [
    getNavigationTools(config, timeout),
    getInteractionTools(config, timeout),
    getInspectionTools(config, timeout),
    getTestingTools(config, timeout),
    getCollaborationTools(config, timeout),
    getDoctorTools(config, timeout),
    getExtractTools(config, timeout),
    getRecorderTools(config, timeout, stepImpls),
  ];

  for (const toolList of toolFactories) {
    for (const def of toolList) {
      register(def);
    }
  }
}
