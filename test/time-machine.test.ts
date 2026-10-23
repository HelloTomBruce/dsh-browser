import { beforeEach, describe, expect, it } from "vitest";
import { sessionTracer } from "../src/browser/session/tracer.js";

describe("会话全景时光机与排障追踪器 (Session Time-Machine Tracer)", () => {
  beforeEach(() => {
    sessionTracer.clear();
  });

  it("支持步骤生命周期打标，并按时间戳聚合该步产生的 Console 日志与网络失败", async () => {
    const profile = "default";

    // 步骤 1 开始
    const step1Id = sessionTracer.startStep(profile, "browser_open", { url: "https://example.com" });
    expect(step1Id).toContain("step-1");

    // 模拟步骤 1 期间产生了一条控制台警告
    sessionTracer.recordConsole(profile, {
      type: "warn",
      text: "Deprecation warning: cookie schema",
      timestamp: Date.now(),
    });

    // 步骤 1 正常结束
    const trace1 = await sessionTracer.endStep(profile, true);
    expect(trace1?.success).toBe(true);
    expect(trace1?.tool).toBe("browser_open");
    expect(trace1?.consoleLogs.length).toBe(1);
    expect(trace1?.consoleLogs[0].text).toContain("Deprecation warning");
    expect(trace1?.failedRequests.length).toBe(0);

    // 步骤 2 开始：模拟发生致命错误与 500 接口
    sessionTracer.startStep(profile, "browser_click", { selector: "#submit-order" });

    sessionTracer.recordConsole(profile, {
      type: "error",
      text: "Uncaught TypeError: Cannot read property 'id' of undefined",
      timestamp: Date.now(),
    });

    sessionTracer.recordFailedRequest(profile, {
      url: "https://example.com/api/order",
      method: "POST",
      status: 500,
      timestamp: Date.now(),
    });

    const trace2 = await sessionTracer.endStep(profile, false, "Timeout 3000ms waiting for selector");
    expect(trace2?.success).toBe(false);
    expect(trace2?.error).toContain("Timeout 3000ms");
    expect(trace2?.consoleLogs.length).toBe(1);
    expect(trace2?.consoleLogs[0].text).toContain("Cannot read property");
    expect(trace2?.failedRequests.length).toBe(1);
    expect(trace2?.failedRequests[0].status).toBe(500);

    // 获取完整时间轴
    const allTraces = sessionTracer.getTraces(profile);
    expect(allTraces.length).toBe(2);
    expect(allTraces[0].tool).toBe("browser_open");
    expect(allTraces[1].tool).toBe("browser_click");
  });

  it("时光机轨迹容量有界 (最多保持 50 条)", async () => {
    const profile = "bounded-test";
    for (let i = 0; i < 60; i++) {
      sessionTracer.startStep(profile, "browser_click", { index: i });
      await sessionTracer.endStep(profile, true);
    }
    const traces = sessionTracer.getTraces(profile);
    expect(traces.length).toBe(50);
    // 第一条应该是第 10 次调用
    expect(traces[0].args?.index).toBe(10);
    expect(traces[49].args?.index).toBe(59);
  });
});
