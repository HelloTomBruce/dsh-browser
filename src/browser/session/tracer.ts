// dsh-browser · 会话全景时光机与链路追踪 (Session Time-Machine Tracer)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { currentProfile } from "../session.js";

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp: number;
  stepId?: string;
}

export interface FailedRequestEntry {
  url: string;
  method: string;
  status?: number;
  error?: string;
  timestamp: number;
  stepId?: string;
}

export interface StepTraceEntry {
  stepId: string;
  stepIndex: number;
  tool: string;
  args?: Record<string, any>;
  url: string;
  startedAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
  consoleLogs: ConsoleLogEntry[];
  failedRequests: FailedRequestEntry[];
  thumbnail?: string; // base64 or file path
  /** 定位失败遥测(M6):失败阶段 + 页面特征,随 /timeline 透出,为按真实流量优化提供数据。 */
  locationFailure?: {
    phase: "zeroMatch" | "ambiguous" | "dialogOverlay" | "staleRef" | "coordinateMiss";
    candidates: number;
    dialogActive: boolean;
    hasShadow: boolean;
  };
}

class SessionTracer {
  private consoleLogsByProfile = new Map<string, ConsoleLogEntry[]>();
  private failedRequestsByProfile = new Map<string, FailedRequestEntry[]>();
  private tracesByProfile = new Map<string, StepTraceEntry[]>();
  private activeStepByProfile = new Map<
    string,
    {
      stepId: string;
      stepIndex: number;
      tool: string;
      args?: Record<string, any>;
      startedAt: number;
      url: string;
    }
  >();
  private stepCounter = 0;

  /** 记录 Console 输出 */
  recordConsole(profile: string, entry: ConsoleLogEntry): void {
    const active = this.activeStepByProfile.get(profile);
    const item = { ...entry, stepId: entry.stepId ?? active?.stepId };
    let list = this.consoleLogsByProfile.get(profile);
    if (!list) {
      list = [];
      this.consoleLogsByProfile.set(profile, list);
    }
    list.push(item);
    if (list.length > 200) list.shift();
  }

  /** 记录失败网络请求 (4xx/5xx 或网络断裂) */
  recordFailedRequest(profile: string, entry: FailedRequestEntry): void {
    const active = this.activeStepByProfile.get(profile);
    const item = { ...entry, stepId: entry.stepId ?? active?.stepId };
    let list = this.failedRequestsByProfile.get(profile);
    if (!list) {
      list = [];
      this.failedRequestsByProfile.set(profile, list);
    }
    list.push(item);
    if (list.length > 100) list.shift();
  }

  /** 步骤开始 */
  startStep(
    profile: string,
    tool: string,
    args?: Record<string, any>,
    page?: Page | null,
  ): string {
    const stepId = `step-${++this.stepCounter}-${Date.now().toString(36)}`;
    let url = "";
    try {
      url = page?.url() ?? "";
    } catch {
      /* ignore */
    }

    this.activeStepByProfile.set(profile, {
      stepId,
      stepIndex: this.stepCounter,
      tool,
      args,
      startedAt: Date.now(),
      url,
    });
    return stepId;
  }

  /** 步骤结束并归档 */
  async endStep(
    profile: string,
    success: boolean,
    error?: string,
    page?: Page | null,
    locationFailure?: StepTraceEntry["locationFailure"],
  ): Promise<StepTraceEntry | null> {
    const active = this.activeStepByProfile.get(profile);
    if (!active) return null;
    this.activeStepByProfile.delete(profile);

    const now = Date.now();
    const durationMs = now - active.startedAt;

    // 筛选该步骤期间产生的 Console 日志与网络失败
    const allLogs = this.consoleLogsByProfile.get(profile) ?? [];
    const stepLogs = allLogs.filter((l) =>
      l.stepId ? l.stepId === active.stepId : l.timestamp >= active.startedAt && l.timestamp <= now,
    );

    const allFailed = this.failedRequestsByProfile.get(profile) ?? [];
    const stepFailed = allFailed.filter((f) =>
      f.stepId ? f.stepId === active.stepId : f.timestamp >= active.startedAt && f.timestamp <= now,
    );

    let thumbnail: string | undefined;
    if (page && !page.isClosed()) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 35, scale: "css" });
        thumbnail = `data:image/jpeg;base64,${buf.toString("base64")}`;
      } catch {
        /* ignore */
      }
    }

    let url = active.url;
    try {
      if (page && !page.isClosed()) {
        url = page.url();
      }
    } catch {
      /* ignore */
    }

    const trace: StepTraceEntry = {
      stepId: active.stepId,
      stepIndex: active.stepIndex,
      tool: active.tool,
      args: active.args,
      url,
      startedAt: active.startedAt,
      durationMs,
      success,
      error,
      consoleLogs: stepLogs,
      failedRequests: stepFailed,
      thumbnail,
      ...(locationFailure !== undefined ? { locationFailure } : {}),
    };

    let traces = this.tracesByProfile.get(profile);
    if (!traces) {
      traces = [];
      this.tracesByProfile.set(profile, traces);
    }
    traces.push(trace);
    if (traces.length > 50) traces.shift();

    return trace;
  }

  getTraces(profile: string): StepTraceEntry[] {
    return this.tracesByProfile.get(profile) ?? [];
  }

  clear(profile?: string): void {
    if (profile) {
      this.consoleLogsByProfile.delete(profile);
      this.failedRequestsByProfile.delete(profile);
      this.tracesByProfile.delete(profile);
      this.activeStepByProfile.delete(profile);
    } else {
      this.consoleLogsByProfile.clear();
      this.failedRequestsByProfile.clear();
      this.tracesByProfile.clear();
      this.activeStepByProfile.clear();
    }
  }
}

export const sessionTracer = new SessionTracer();
