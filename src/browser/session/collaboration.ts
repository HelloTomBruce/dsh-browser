// dsh-browser · 会话管理 — 人机协同、审批与在途计数状态
/**
 * 当前人工接管等待状态(browser_pause_for_human 等待期间非空),
 * 供实时画面面板展示「等待人工操作」提示。
 */
let pauseState: { instruction: string; startedAt: number } | null = null;

export function setPauseInstruction(instruction: string): void {
  pauseState = { instruction, startedAt: Date.now() };
}

export function clearPauseInstruction(): void {
  pauseState = null;
}

export function currentPause(): { instruction: string; startedAt: number } | null {
  return pauseState;
}


/** 一次待审批的敏感操作(browser_confirm 等待期间供面板展示与提交决策)。 */
export interface PendingConfirm {
  id: string;
  reason: string;
  tool?: string;
  args?: Record<string, any>;
  startedAt: number;
  decision?: "allowed" | "denied";
}

let pendingConfirm: PendingConfirm | null = null;

export function setPendingConfirm(entry: PendingConfirm): void {
  pendingConfirm = entry;
}

export function getPendingConfirm(): PendingConfirm | null {
  return pendingConfirm;
}

export function clearPendingConfirm(): void {
  pendingConfirm = null;
}

/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
export function resolveConfirm(id: string, decision: "allowed" | "denied"): boolean {
  if (pendingConfirm === null || pendingConfirm.id !== id) return false;
  pendingConfirm.decision = decision;
  return true;
}

// F2 面板一键重跑的忙碌判定:agent 会话有 live 浏览器工具调用在途时,
// POST /runs/rerun 回 409(面板据此置灰重跑按钮)。
let toolInFlight = 0;

/** live 工具调用开始(register 包装层调用)。 */
export function noteToolStart(): void {
  toolInFlight++;
}

/** live 工具调用结束(成功/失败都算结束)。 */
export function noteToolEnd(): void {
  if (toolInFlight > 0) toolInFlight--;
}

/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
export function activeToolCalls(): number {
  return toolInFlight;
}

// ---------------------------------------------------------------------------
