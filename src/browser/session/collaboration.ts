// dsh-browser · 会话管理 — 人机协同、审批与在途计数状态
/**
 * 当前人工接管等待状态(browser_pause_for_human 等待期间非空),
 * 供实时画面面板展示「等待人工操作」提示。
 */
let pauseState: { instruction: string; startedAt: number } | null = null;

let interactivePanelPresent = true;

/** 标记当前宿主环境是否挂载了交互面板(DSH 插件=true;独立 MCP 模式=false)。 */
export function setInteractivePanelPresent(present: boolean): void {
  interactivePanelPresent = present;
}

export function isInteractivePanelPresent(): boolean {
  return interactivePanelPresent;
}

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

// ---------------------------------------------------------------------------
// 面板点选教学(browser_pick_element):agent 挂起等待,用户在实时画面大图上
// 点击目标元素,面板把「截图位图像素坐标 + 图片尺寸」POST 回来,Node 侧按
// CDP metadata(deviceWidth/Height)换算成页面视口 CSS 坐标后 elementFromPoint。
// ---------------------------------------------------------------------------

/** 一次待点选的教学请求(browser_pick_element 等待期间供面板展示与提交)。 */
export interface PendingPick {
  id: string;
  instruction: string;
  startedAt: number;
  /** 建立等待时快照的推流帧视口 CSS 尺寸(CDP metadata);坐标换算基准。 */
  deviceWidth?: number;
  deviceHeight?: number;
  /** 面板提交的点选结果(截图位图像素坐标 + 截图尺寸)。 */
  pick?: { x: number; y: number; imgW: number; imgH: number };
}

let pendingPick: PendingPick | null = null;

export function setPendingPick(entry: PendingPick): void {
  pendingPick = entry;
}

export function getPendingPick(): PendingPick | null {
  return pendingPick;
}

export function clearPendingPick(): void {
  pendingPick = null;
}

/** 面板提交点选坐标;id 不匹配(已被新请求取代/超时清理)时返回 false。 */
export function resolvePick(
  id: string,
  pick: { x: number; y: number; imgW: number; imgH: number },
): boolean {
  if (pendingPick === null || pendingPick.id !== id) return false;
  pendingPick.pick = pick;
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
