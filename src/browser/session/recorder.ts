// dsh-browser · 会话管理 — 步骤录制、DOM 事件注入与打点
import type { ReplayStep, SelectorHint } from "../types.js";
import { injectWalker } from "../walker.js";


/** 已保存的录制脚本:name → 步骤数组。 */
export const savedRecordings = new Map<string, { steps: ReplayStep[]; savedAt: number }>();
/** 当前录制中的 buffer(非空 = 录制中)。 */
let recordingSteps: TestCall[] | null = null;
/** 最近一次 start→stop 的录制结果(save 优先使用;下次 start 时覆盖)。 */
let lastRecording: TestCall[] | null = null;

/** 一次工具调用的记录(操作轨迹 / 录制 / 回放共用)。 */
export interface TestCall {
  tool: string;
  args: Record<string, any>;
  ok: boolean;
  ms: number;
  ts: number;
  error?: string;
  /** 录制时采集的选择器指纹(回放自愈用;register 包装层异步补齐)。 */
  meta?: { hint?: SelectorHint; source?: "human" };
  /** source: "human" 表示这条来自用户在浏览器中的手动操作(混合录制)。 */
  source?: "human";
}

/** 操作轨迹(全局,记录 currentProfile;上限 500 条)。 */
const testLog: TestCall[] = [];

export function isRecording(): boolean {
  return recordingSteps !== null;
}

export function startRecording(): void {
  lastRecording = null; // 新一轮录制使上一次结果失效
  recordingSteps = [];
}

export function stopRecording(): TestCall[] {
  const steps = recordingSteps ?? [];
  recordingSteps = null;
  lastRecording = steps;
  return steps;
}

/** 最近一次完整录制(start→stop)的 buffer;从未录制过返回 null。 */
export function lastRecordingOf(): TestCall[] | null {
  return lastRecording;
}

/** 操作轨迹追加(同时写入录制 buffer,排除 record/replay 自身)。返回存入的调用对象(供调用方补 meta)。 */
export function recordCall(call: TestCall): TestCall {
  testLog.push(call);
  if (testLog.length > 500) testLog.shift();
  if (recordingSteps !== null && call.tool !== "browser_record" && call.tool !== "browser_replay") {
    recordingSteps.push(call);
    if (recordingSteps.length > 500) recordingSteps.shift();
  }
  return call;
}

/** 操作轨迹(按时间倒序,最新在前)。 */
export function testLogOf(): TestCall[] {
  return [...testLog].reverse();
}

export function clearTestLog(): void {
  testLog.length = 0;
}



/** window 上的回传 binding 名(须为合法 JS 标识符)。 */
export const HUMAN_BINDING = "__dshBrowserHumanEvent";

/** 最近一次 agent DOM 操作(点击/输入/选择)的时间戳;用于区分人手与工具回声。 */
let lastAgentActionAt = 0;

/** agent 即将/刚刚执行了 DOM 操作(register 包装层调用);1.5s 内的页内事件视为工具回声。 */
export function noteAgentAction(): void {
  lastAgentActionAt = Date.now();
}

/** 导出供测试:距上次 agent 操作是否在去重窗口内。 */
export function agentActionRecent(now = Date.now(), windowMs = 1_500): boolean {
  return now - lastAgentActionAt < windowMs;
}

/**
 * 页内人工操作事件 → 录制步骤(纯函数,导出供测试)。
 * payload 由 installHumanRecorder 生成:{ kind, selector, value?, testid?, role?, name?, id?, text?, tag? }。
 * 无法映射(缺 selector / 未知 kind / 空输入)返回 null。
 */
export function humanEventToStep(payload: unknown): {
  tool: string;
  args: Record<string, any>;
  meta: { hint: SelectorHint; source: "human" };
} | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const selector = typeof p.selector === "string" ? p.selector : "";
  if (!selector) return null;
  const hint: SelectorHint = {
    ...(p.testid !== undefined && p.testid !== "" ? { testid: String(p.testid) } : {}),
    ...(p.role !== undefined && p.role !== "" ? { role: String(p.role) } : {}),
    ...(p.name !== undefined && p.name !== "" ? { name: String(p.name) } : {}),
    ...(p.id !== undefined && p.id !== "" ? { id: String(p.id) } : {}),
    ...(p.text !== undefined && p.text !== "" ? { text: String(p.text) } : {}),
    ...(p.tag !== undefined && p.tag !== "" ? { tag: String(p.tag) } : {}),
  };
  if (p.kind === "click") {
    return { tool: "browser_click", args: { selector }, meta: { hint, source: "human" } };
  }
  if (p.kind === "input") {
    const text = typeof p.value === "string" ? p.value : "";
    if (text === "") return null; // 清空类输入无法可靠回放,跳过
    return { tool: "browser_type", args: { selector, text }, meta: { hint, source: "human" } };
  }
  if (p.kind === "select") {
    const option = typeof p.value === "string" ? p.value.trim() : "";
    if (!option) return null;
    return { tool: "browser_select", args: { selector, option }, meta: { hint, source: "human" } };
  }
  return null;
}

/** binding 回调入站口:仅录制中生效;去重窗口内(agent 工具回声)丢弃。 */
export function handleHumanEvent(payload: unknown): void {
  if (!isRecording()) return;
  if (agentActionRecent()) return;
  const step = humanEventToStep(payload);
  if (step === null) return;
  recordCall({
    tool: step.tool,
    args: step.args,
    ok: true,
    ms: 0,
    ts: Date.now(),
    meta: step.meta,
    source: "human",
  });
}

/**
 * 页内注入的人工操作监听(addInitScript 序列化;每次导航自动重装)。
 * 监听常驻但 node 侧只在录制中生效,关闭录制等价于"移除"。
 * 只上报可交互元素上的 click 与表单控件的 change,避免逐键噪音。
 * F5 收敛:cssPath 等元素描述来自 walker.ts 单一来源(构建期拼装注入),
 * 不再持有内联副本;payload 字段语义与 v0.3 完全一致。
 */
export const installHumanRecorder = injectWalker<unknown, void>((_payload, w) => {
  const cssPath = w.cssPath;
  const w2 = window as unknown as Record<string, unknown>;
  if (w2.__dshHumanRecorder === true) return;
  w2.__dshHumanRecorder = true;
  const BINDING = "__dshBrowserHumanEvent";
  const INTERACTIVE =
    "a,button,input,select,textarea,summary,[role='button'],[role='tab'],[role='menuitem'],[role='option'],[role='switch'],[role='checkbox']";

  function payloadOf(el: Element, kind: string, value?: string): Record<string, unknown> {
    const aria = el.getAttribute("aria-label");
    return {
      kind,
      selector: cssPath(el),
      ...(value !== undefined ? { value } : {}),
      testid: el.getAttribute("data-testid") ?? el.getAttribute("data-test-id") ?? "",
      role: el.getAttribute("role") ?? "",
      name: aria && aria.trim() ? aria.trim().slice(0, 40) : "",
      id: el.id ?? "",
      text: ((el as HTMLElement).innerText || el.textContent || "").trim().slice(0, 40),
      tag: el.tagName.toLowerCase(),
    };
  }

  function send(payload: Record<string, unknown>): void {
    try {
      const fn = w2[BINDING] as ((p: unknown) => unknown) | undefined;
      if (typeof fn === "function") void Promise.resolve(fn(payload)).catch(() => {});
    } catch {
      /* binding 未就绪(导航瞬间)忽略 */
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      const target = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
      if (target === null) return;
      send(payloadOf(target, "click"));
    },
    true,
  );

  document.addEventListener(
    "change",
    (e) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t === null) return;
      if (t.tagName === "SELECT") {
        const opt = (t as HTMLSelectElement).selectedOptions[0];
        send(payloadOf(t, "select", (opt ? opt.textContent : "").trim()));
      } else if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
        const type = (t.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox" || type === "radio") return; // click 事件已记录
        if (type === "file") return; // 文件选择无法回放
        send(payloadOf(t, "input", (t as HTMLInputElement).value));
      }
    },
    true,
  );
});

