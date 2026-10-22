// dsh-browser · 会话管理 — 人机协同、审批与在途计数状态
/**
 * 当前人工接管等待状态(browser_pause_for_human 等待期间非空),
 * 供实时画面面板展示「等待人工操作」提示。
 */
let pauseState = null;
export function setPauseInstruction(instruction) {
    pauseState = { instruction, startedAt: Date.now() };
}
export function clearPauseInstruction() {
    pauseState = null;
}
export function currentPause() {
    return pauseState;
}
let pendingConfirm = null;
export function setPendingConfirm(entry) {
    pendingConfirm = entry;
}
export function getPendingConfirm() {
    return pendingConfirm;
}
export function clearPendingConfirm() {
    pendingConfirm = null;
}
/** 面板提交审批决策;id 不匹配(已被新审批取代/超时清理)时返回 false。 */
export function resolveConfirm(id, decision) {
    if (pendingConfirm === null || pendingConfirm.id !== id)
        return false;
    pendingConfirm.decision = decision;
    return true;
}
// F2 面板一键重跑的忙碌判定:agent 会话有 live 浏览器工具调用在途时,
// POST /runs/rerun 回 409(面板据此置灰重跑按钮)。
let toolInFlight = 0;
/** live 工具调用开始(register 包装层调用)。 */
export function noteToolStart() {
    toolInFlight++;
}
/** live 工具调用结束(成功/失败都算结束)。 */
export function noteToolEnd() {
    if (toolInFlight > 0)
        toolInFlight--;
}
/** 当前在途的 live 工具调用数(0 = agent 空闲)。 */
export function activeToolCalls() {
    return toolInFlight;
}
// ---------------------------------------------------------------------------
//# sourceMappingURL=collaboration.js.map