class SessionTracer {
    consoleLogsByProfile = new Map();
    failedRequestsByProfile = new Map();
    tracesByProfile = new Map();
    activeStepByProfile = new Map();
    stepCounter = 0;
    /** 记录 Console 输出 */
    recordConsole(profile, entry) {
        const active = this.activeStepByProfile.get(profile);
        const item = { ...entry, stepId: entry.stepId ?? active?.stepId };
        let list = this.consoleLogsByProfile.get(profile);
        if (!list) {
            list = [];
            this.consoleLogsByProfile.set(profile, list);
        }
        list.push(item);
        if (list.length > 200)
            list.shift();
    }
    /** 记录失败网络请求 (4xx/5xx 或网络断裂) */
    recordFailedRequest(profile, entry) {
        const active = this.activeStepByProfile.get(profile);
        const item = { ...entry, stepId: entry.stepId ?? active?.stepId };
        let list = this.failedRequestsByProfile.get(profile);
        if (!list) {
            list = [];
            this.failedRequestsByProfile.set(profile, list);
        }
        list.push(item);
        if (list.length > 100)
            list.shift();
    }
    /** 步骤开始 */
    startStep(profile, tool, args, page) {
        const stepId = `step-${++this.stepCounter}-${Date.now().toString(36)}`;
        let url = "";
        try {
            url = page?.url() ?? "";
        }
        catch {
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
    async endStep(profile, success, error, page) {
        const active = this.activeStepByProfile.get(profile);
        if (!active)
            return null;
        this.activeStepByProfile.delete(profile);
        const now = Date.now();
        const durationMs = now - active.startedAt;
        // 筛选该步骤期间产生的 Console 日志与网络失败
        const allLogs = this.consoleLogsByProfile.get(profile) ?? [];
        const stepLogs = allLogs.filter((l) => l.stepId ? l.stepId === active.stepId : l.timestamp >= active.startedAt && l.timestamp <= now);
        const allFailed = this.failedRequestsByProfile.get(profile) ?? [];
        const stepFailed = allFailed.filter((f) => f.stepId ? f.stepId === active.stepId : f.timestamp >= active.startedAt && f.timestamp <= now);
        let thumbnail;
        if (page && !page.isClosed()) {
            try {
                const buf = await page.screenshot({ type: "jpeg", quality: 35, scale: "css" });
                thumbnail = `data:image/jpeg;base64,${buf.toString("base64")}`;
            }
            catch {
                /* ignore */
            }
        }
        let url = active.url;
        try {
            if (page && !page.isClosed()) {
                url = page.url();
            }
        }
        catch {
            /* ignore */
        }
        const trace = {
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
        };
        let traces = this.tracesByProfile.get(profile);
        if (!traces) {
            traces = [];
            this.tracesByProfile.set(profile, traces);
        }
        traces.push(trace);
        if (traces.length > 50)
            traces.shift();
        return trace;
    }
    getTraces(profile) {
        return this.tracesByProfile.get(profile) ?? [];
    }
    clear(profile) {
        if (profile) {
            this.consoleLogsByProfile.delete(profile);
            this.failedRequestsByProfile.delete(profile);
            this.tracesByProfile.delete(profile);
            this.activeStepByProfile.delete(profile);
        }
        else {
            this.consoleLogsByProfile.clear();
            this.failedRequestsByProfile.clear();
            this.tracesByProfile.clear();
            this.activeStepByProfile.clear();
        }
    }
}
export const sessionTracer = new SessionTracer();
//# sourceMappingURL=tracer.js.map