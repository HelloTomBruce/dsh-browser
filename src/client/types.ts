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
