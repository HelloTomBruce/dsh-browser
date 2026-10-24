// browser_pick_element 面板点选教学测试:状态机、坐标换算与 pickToolOnPage
// 编排(命中/超时/被取代/元数据缺失)。
import { describe, expect, it, vi } from "vitest";
import {
  setPendingPick, getPendingPick, clearPendingPick, resolvePick,
} from "../src/browser/session/collaboration.js";
import { pickToolOnPage } from "../src/browser/tools/collaboration.js";
import { screencastManager } from "../src/browser/session/screencast.js";
import type { Page } from "playwright-core";

describe("PendingPick 状态机", () => {
  it("set/get/resolve/clear 基础流转", () => {
    setPendingPick({ id: "pick-1", instruction: "请点选", startedAt: 1 });
    expect(getPendingPick()?.id).toBe("pick-1");
    expect(resolvePick("pick-1", { x: 10, y: 20, imgW: 100, imgH: 80 })).toBe(true);
    expect(getPendingPick()?.pick).toEqual({ x: 10, y: 20, imgW: 100, imgH: 80 });
    clearPendingPick();
    expect(getPendingPick()).toBeNull();
  });

  it("resolvePick id 不匹配返回 false(防并发误放行)", () => {
    setPendingPick({ id: "pick-a", instruction: "x", startedAt: 1 });
    expect(resolvePick("pick-b", { x: 0, y: 0, imgW: 1, imgH: 1 })).toBe(false);
    expect(getPendingPick()?.pick).toBeUndefined();
    clearPendingPick();
  });
});

function fakePage(evaluateImpl?: (fn: any, arg: any) => any): Page {
  return {
    evaluate: vi.fn(evaluateImpl ?? (() => null)),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
  } as unknown as Page;
}

describe("pickToolOnPage", () => {
  it("用户点选命中:按 deviceWidth/imgW 换算坐标并返回描述 + ref", async () => {
    // 模拟推流帧 metadata:deviceWidth 1280(CSS),截图 640px 宽 → 放大 2 倍
    vi.spyOn(screencastManager, "getLastFrame").mockReturnValue({
      buffer: Buffer.alloc(0),
      base64: "",
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
      timestamp: 1,
    } as any);
    let evaluateArg: any = null;
    const page = fakePage((fn, arg) => {
      evaluateArg = arg;
      return {
        role: "button", name: "登录", selector: "#login", testid: "login-btn",
        id: "login", tag: "button", text: "登录", visible: true,
      };
    });
    // 起一个后台定时器模拟用户在 600ms 后点选
    setTimeout(() => {
      resolvePick((getPendingPick() as any).id, { x: 320, y: 200, imgW: 640, imgH: 400 });
    }, 600);
    const res: any = await pickToolOnPage(page, {} as any, { timeoutMs: 5000 });
    expect(res.picked).toBe(true);
    expect(res.status).toBe("picked");
    // 换算:320 * 1280 / 640 = 640;200 * 800 / 400 = 400
    expect(evaluateArg).toEqual({ x: 640, y: 400 });
    expect(res.selector).toBe("#login");
    expect(res.role).toBe("button");
    expect(res.name).toBe("登录");
    expect(res.ref).toMatch(/^e\d+$/);
    expect(res.hint).toMatchObject({ role: "button", name: "登录", tag: "button" });
    expect(getPendingPick()).toBeNull(); // finally 清理
  });

  it("超时不抛错,返回 picked:false / timedOut", async () => {
    vi.spyOn(screencastManager, "getLastFrame").mockReturnValue(null as any);
    const page = fakePage();
    const res: any = await pickToolOnPage(page, {} as any, { timeoutMs: 1100 });
    expect(res.picked).toBe(false);
    expect(res.status).toBe("timedOut");
    expect(res.instruction).toContain("点击");
  }, 10_000);

  it("点在空白区域(missed):坐标换算正确但 elementFromPoint 无命中", async () => {
    vi.spyOn(screencastManager, "getLastFrame").mockReturnValue({
      buffer: Buffer.alloc(0), base64: "", metadata: { deviceWidth: 1000, deviceHeight: 600 }, timestamp: 1,
    } as any);
    const page = fakePage(() => null);
    setTimeout(() => {
      resolvePick((getPendingPick() as any).id, { x: 50, y: 30, imgW: 100, imgH: 60 });
    }, 100);
    const res: any = await pickToolOnPage(page, {} as any, { timeoutMs: 5000 });
    expect(res.picked).toBe(false);
    expect(res.status).toBe("missed");
  });

  it("无元数据且无 viewport 时返回 missed 并说明原因", async () => {
    vi.spyOn(screencastManager, "getLastFrame").mockReturnValue(null as any);
    const page = {
      evaluate: vi.fn(),
      viewportSize: vi.fn().mockReturnValue(null),
    } as unknown as Page;
    setTimeout(() => {
      resolvePick((getPendingPick() as any).id, { x: 1, y: 1, imgW: 10, imgH: 10 });
    }, 100);
    const res: any = await pickToolOnPage(page, {} as any, { timeoutMs: 5000 });
    expect(res.picked).toBe(false);
    expect(res.status).toBe("missed");
    expect(res.detail).toContain("元数据");
  });

  it("等待中被新请求取代:按超时语义返回", async () => {
    vi.spyOn(screencastManager, "getLastFrame").mockReturnValue(null as any);
    const page = fakePage();
    setTimeout(() => {
      setPendingPick({ id: "pick-new", instruction: "新请求", startedAt: Date.now() });
    }, 100);
    const res: any = await pickToolOnPage(page, {} as any, { timeoutMs: 1100 });
    expect(res.picked).toBe(false);
    expect(res.detail).toContain("取代");
  }, 10_000);
});
