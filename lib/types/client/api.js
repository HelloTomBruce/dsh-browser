let cachedBasePath = null;
/** 获取插件后端 API 基路径 (默认为 /browser) */
export async function getBasePath() {
    if (cachedBasePath !== null)
        return cachedBasePath;
    try {
        const res = await fetch("/__dsh-browser-view__/config", { cache: "no-store" });
        if (res.ok) {
            const data = await res.json();
            if (typeof data?.basePath === "string" && data.basePath) {
                cachedBasePath = data.basePath;
                return data.basePath;
            }
        }
    }
    catch {
        /* ignore fallback */
    }
    cachedBasePath = "/browser";
    return cachedBasePath;
}
export async function fetchStatus(base) {
    try {
        const res = await fetch(`${base}/status`, { cache: "no-store" });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
}
export async function fetchHistory(base) {
    try {
        const res = await fetch(`${base}/history`, { cache: "no-store" });
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data?.history) ? data.history : [];
    }
    catch {
        return [];
    }
}
export async function fetchOperations(base) {
    try {
        const res = await fetch(`${base}/log`, { cache: "no-store" });
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data?.calls) ? data.calls : [];
    }
    catch {
        return [];
    }
}
export async function fetchLatestRun(base) {
    try {
        const res = await fetch(`${base}/runs/latest`, { cache: "no-store" });
        if (!res.ok)
            return { run: null, busy: false };
        const data = await res.json();
        return {
            run: data?.run ?? null,
            busy: data?.busy === true,
        };
    }
    catch {
        return { run: null, busy: false };
    }
}
export async function fetchPendingConfirm(base) {
    try {
        const res = await fetch(`${base}/confirm`, { cache: "no-store" });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data?.confirm ?? data?.pending ?? null;
    }
    catch {
        return null;
    }
}
export async function submitConfirmDecision(base, id, decision) {
    try {
        const res = await fetch(`${base}/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, decision }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
export async function triggerRerun(base, source, retryOf) {
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
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
export async function fetchRecordings(base) {
    try {
        const res = await fetch(`${base}/recordings`, { cache: "no-store" });
        if (!res.ok)
            return [];
        const data = await res.json();
        return Array.isArray(data?.recordings) ? data.recordings : [];
    }
    catch {
        return [];
    }
}
export async function fetchRecordingDetail(base, name) {
    try {
        const res = await fetch(`${base}/recordings/detail?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
}
export async function deleteRecordingApi(base, name) {
    try {
        const res = await fetch(`${base}/recordings`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=api.js.map