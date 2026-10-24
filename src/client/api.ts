// dsh-browser · 客户端 — HTTP API 接口封装
import type {
  BrowserOp, BrowserStatus, LatestRun,
  NavHistoryItem, PendingConfirm, PendingPick, RecordingDetail, RecordingRow,
} from "./types.js";

let cachedBasePath: string | null = null;

/** 获取插件后端 API 基路径 (默认为 /browser) */
export async function getBasePath(): Promise<string> {
  if (cachedBasePath !== null) return cachedBasePath;
  try {
    const res = await fetch("/__dsh-browser-view__/config", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.basePath === "string" && data.basePath) {
        cachedBasePath = data.basePath;
        return data.basePath;
      }
    }
  } catch {
    /* ignore fallback */
  }
  cachedBasePath = "/browser";
  return cachedBasePath;
}

export async function fetchStatus(base: string): Promise<BrowserStatus | null> {
  try {
    const res = await fetch(`${base}/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchHistory(base: string): Promise<NavHistoryItem[]> {
  try {
    const res = await fetch(`${base}/history`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.history) ? data.history : [];
  } catch {
    return [];
  }
}

export async function fetchOperations(base: string): Promise<BrowserOp[]> {
  try {
    const res = await fetch(`${base}/log`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.calls) ? data.calls : [];
  } catch {
    return [];
  }
}

export async function fetchLatestRun(base: string): Promise<{ run: LatestRun | null; busy: boolean }> {
  try {
    const res = await fetch(`${base}/runs/latest`, { cache: "no-store" });
    if (!res.ok) return { run: null, busy: false };
    const data = await res.json();
    return {
      run: data?.run ?? null,
      busy: data?.busy === true,
    };
  } catch {
    return { run: null, busy: false };
  }
}

export async function fetchPendingConfirm(base: string): Promise<PendingConfirm | null> {
  try {
    const res = await fetch(`${base}/confirm`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.confirm ?? data?.pending ?? null;
  } catch {
    return null;
  }
}

export async function submitConfirmDecision(
  base: string,
  id: string,
  decision: "allowed" | "denied",
): Promise<boolean> {
  try {
    const res = await fetch(`${base}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchPendingPick(base: string): Promise<PendingPick | null> {
  try {
    const res = await fetch(`${base}/pick`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.pick ?? null;
  } catch {
    return null;
  }
}

/** 提交点选坐标(x/y 为截图位图像素坐标,imgW/imgH 为截图尺寸;服务端换算成视口 CSS 坐标)。 */
export async function submitPick(
  base: string,
  id: string,
  x: number,
  y: number,
  imgW: number,
  imgH: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${base}/pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, x, y, imgW, imgH }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function triggerRerun(
  base: string,
  source: string,
  retryOf?: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`${base}/runs/rerun`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, ...(retryOf ? { retryOf } : {}) }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: errText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchRecordings(base: string): Promise<RecordingRow[]> {
  try {
    const res = await fetch(`${base}/recordings`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.recordings) ? data.recordings : [];
  } catch {
    return [];
  }
}

export async function fetchRecordingDetail(base: string, name: string): Promise<RecordingDetail | null> {
  try {
    const res = await fetch(`${base}/recordings/detail?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function deleteRecordingApi(base: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/recordings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
