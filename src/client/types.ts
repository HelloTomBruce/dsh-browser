// dsh-browser · 客户端 — 类型定义

export interface Palette {
  primary: string;
  secondary: string;
  tertiary: string;
  border: string;
  hoverBg: string;
  danger: string;
}

export interface RecordingRow {
  name: string;
  steps: number;
  savedAt: number;
  preview: string;
}

export interface RecordingDetail {
  name: string;
  steps: Array<{ tool: string; args: unknown }>;
}

export interface BrowserStatus {
  open: boolean;
  tabs?: number;
  url?: string;
  title?: string;
  channel?: string;
  pause?: { instruction: string; startedAt: number } | null;
}

export interface BrowserOp {
  tool: string;
  ok: boolean;
  ms: number;
  ts: number;
  error?: string;
}

export interface NavHistoryItem {
  url: string;
  title?: string;
  ts: number;
}

export interface PendingConfirm {
  id: string;
  reason: string;
  tool?: string;
  args?: Record<string, unknown>;
  startedAt: number;
  decision?: "allowed" | "denied";
}

/** 面板点选教学请求(browser_pick_element 等待期间轮询到)。 */
export interface PendingPick {
  id: string;
  instruction: string;
  startedAt: number;
}

/** 等待人工登录请求(browser_wait_for_login 等待期间轮询到,用户点「我已完成登录」)。 */
export interface PendingLoginWait {
  id: string;
  instruction: string;
  startedAt: number;
  done?: boolean;
}

export interface LatestRun {
  runId: string;
  ts: number;
  source: string;
  passed: number;
  total: number;
  failed: number;
  healedCount: number;
  row?: number;
  retries?: { attempted: number; recovered: number };
  retryOf?: string;
}
