// browser_assert / browser_wait_for 的 bridge 条件类型测试:checkOnce 页内调用
// __DSH_BRIDGE__ 方法并断言返回(truthy / expect 深比较 / expectContains / 无桥 /
// 方法抛错五态)。stub page.evaluate 模拟桥的存在与行为。
import { describe, it, expect, vi } from "vitest";
import { checkOnce } from "../src/browser/tools/testing.js";
import type { Page } from "playwright-core";

function makePage(bridge: Record<string, (...args: unknown[]) => unknown> | null): Page {
  const page: any = {
    evaluate: vi.fn().mockImplementation(async (fn: unknown, payload: { method: string; args: unknown[] }) => {
      // 与页内函数同语义:无桥/无方法抛 NO_BRIDGE 前缀错误,否则调用桥方法
      if (bridge === null) throw new Error("NO_BRIDGE:页面无 __DSH_BRIDGE__(未接入 vite-plugin-dsh-bridge?)");
      const m = (bridge as any)[payload.method];
      if (typeof m !== "function") throw new Error(`NO_BRIDGE:__DSH_BRIDGE__ 无方法 ${payload.method}`);
      return await m(...payload.args);
    }),
  };
  return page as Page;
}

describe("checkOnce 的 bridge 条件", () => {
  it("缺省 expect:truthy 判定通过/假值失败", async () => {
    const page = makePage({ getFormSnapshot: () => ({ name: "规则A", valid: true }) });
    expect((await checkOnce(page, { bridge: { method: "getFormSnapshot" } })).ok).toBe(true);
    const page2 = makePage({ getActiveRequestCount: () => 0 });
    const r = await checkOnce(page2, { bridge: { method: "getActiveRequestCount" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("返回假值");
  });

  it("expect 深比较:相等通过,不等失败并给出实际/期望", async () => {
    const page = makePage({ getFormSnapshot: () => ({ name: "规则A", enableFlag: 1 }) });
    expect((await checkOnce(page, { bridge: { method: "getFormSnapshot", expect: { name: "规则A", enableFlag: 1 } } })).ok).toBe(true);
    const r = await checkOnce(page, { bridge: { method: "getFormSnapshot", expect: { name: "规则B" } } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("≠ 期望");
  });

  it("expectContains:字符串与对象结果均支持子串断言", async () => {
    const page = makePage({ getInteractiveMap: () => "## 交互地图\n- [B2] 提交按钮", getActiveOverlay: () => ({ title: "确认删除" }) });
    expect((await checkOnce(page, { bridge: { method: "getInteractiveMap", expectContains: "提交按钮" } })).ok).toBe(true);
    expect((await checkOnce(page, { bridge: { method: "getActiveOverlay", expectContains: "确认删除" } })).ok).toBe(true);
    const r = await checkOnce(page, { bridge: { method: "getInteractiveMap", expectContains: "不存在的元素" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("不含");
  });

  it("无桥:fail 详情指明页面未接入", async () => {
    const page = makePage(null);
    const r = await checkOnce(page, { bridge: { method: "getFormSnapshot" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("页面无 __DSH_BRIDGE__");
  });

  it("桥方法抛错:fail 详情含方法名与错误", async () => {
    const page = makePage({ boom: () => { throw new Error("bridge exploded"); } });
    const r = await checkOnce(page, { bridge: { method: "boom" } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("boom() 执行失败");
    expect(r.detail).toContain("bridge exploded");
  });

  it("缺 method:直接 fail 不触发页内调用", async () => {
    const page = makePage({});
    const r = await checkOnce(page, { bridge: {} });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("需要 method");
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
