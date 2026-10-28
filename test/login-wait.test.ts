// browser_wait_for_login 单元测试:用 fake page 注入 runWaitForLoginOnPage,覆盖:
//   1. 等待期间 pendingLoginWait 携带(默认/自定义)instruction,结束后清理;
//   2. 用户在面板点「我已完成登录」(resolveLoginWait)后立即 loggedIn:true;
//   3. 被新的等待请求取代时按未完成退出(不误认他人确认);
//   4. successSelector 命中完成(多标签扫描,命中页成为 targetPage);
//   5. successUrl 正则命中完成;
//   6. 原标签关闭时自动迁移至存活页完成;
//   7. 超时返回 loggedIn:false(不抛错,detail 说明用户未确认);
//   8. waitForLoginTool 无面板且无显式条件时 fail-fast 抛错(MCP 独立模式)。
import { describe, it, expect, afterEach } from "vitest";
import { runWaitForLoginOnPage, waitForLoginTool } from "../src/browser/tools.js";
import {
  getPendingLoginWait,
  clearPendingLoginWait,
  resolveLoginWait,
  setPendingLoginWait,
  setInteractivePanelPresent,
} from "../src/browser/session.js";

interface FakePageOpts {
  visible?: boolean;
  url?: string;
  urlChangesAfter?: number;
  targetUrl?: string;
  isClosed?: boolean;
  contextPages?: any[];
}

function makeFakePage(opts: FakePageOpts = {}) {
  let ticks = 0;
  const startUrl = opts.url ?? "https://example.com/login";
  let closed = opts.isClosed ?? false;

  const page = {
    url: () =>
      ticks >= (opts.urlChangesAfter ?? Number.POSITIVE_INFINITY)
        ? opts.targetUrl ?? "https://example.com/dashboard"
        : startUrl,
    isClosed: () => closed,
    waitForTimeout: async () => {
      // 真实等待一小片(10ms):立即 resolve 会让等待循环退化为纯微任务热旋,
      // 饿死测试侧 setTimeout(外部驱动 pending 状态变化将永远迟到)
      ticks += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    locator: (_sel: string) => ({
      first: () => ({
        isVisible: async () => opts.visible ?? false,
      }),
    }),
    context: () => ({
      pages: () => (opts.contextPages ? opts.contextPages : [page]),
    }),
    _setClosed: (c: boolean) => {
      closed = c;
    },
  } as any;

  return page;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  clearPendingLoginWait();
  setInteractivePanelPresent(true);
});

describe("runWaitForLoginOnPage", () => {
  it("等待期间置入 pendingLoginWait(默认 instruction),结束后清理", async () => {
    const page = makeFakePage();
    const waitP = runWaitForLoginOnPage(page, { timeoutMs: 5_000, pollIntervalMs: 100 });
    await sleep(100);
    const pending = getPendingLoginWait();
    expect(pending).not.toBeNull();
    expect(pending!.instruction).toBe("请在浏览器窗口中完成登录");
    expect(pending!.done).toBeUndefined();
    resolveLoginWait(pending!.id);
    const result = await waitP;
    expect(result.loggedIn).toBe(true);
    expect(getPendingLoginWait()).toBeNull();
  });

  it("自定义 instruction 写入 pendingLoginWait", async () => {
    const page = makeFakePage();
    const waitP = runWaitForLoginOnPage(page, {
      instruction: "请扫码登录微信公众号",
      timeoutMs: 5_000,
      pollIntervalMs: 100,
    });
    await sleep(100);
    expect(getPendingLoginWait()!.instruction).toBe("请扫码登录微信公众号");
    resolveLoginWait(getPendingLoginWait()!.id);
    const result = await waitP;
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("用户已在面板确认");
  });

  it("用户面板确认后立即返回成功", async () => {
    const page = makeFakePage();
    const waitP = runWaitForLoginOnPage(page, { timeoutMs: 8_000, pollIntervalMs: 100 });
    await sleep(150);
    expect(resolveLoginWait(getPendingLoginWait()!.id)).toBe(true);
    const result = await waitP;
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toBe("用户已在面板确认完成登录");
  });

  it("id 不匹配的确认不被认领(防误放行)", async () => {
    const page = makeFakePage();
    const waitP = runWaitForLoginOnPage(page, { timeoutMs: 600, pollIntervalMs: 100 });
    await sleep(100);
    expect(resolveLoginWait("login-not-mine")).toBe(false);
    const result = await waitP;
    expect(result.loggedIn).toBe(false);
  });

  it("被新的等待请求取代时按未完成退出", async () => {
    const page = makeFakePage();
    const waitP = runWaitForLoginOnPage(page, { timeoutMs: 8_000, pollIntervalMs: 100 });
    await sleep(100);
    setPendingLoginWait({ id: "login-new", instruction: "新的等待", startedAt: Date.now() });
    const result = await waitP;
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toContain("取代");
    // 新请求不被本次 finally 清理
    expect(getPendingLoginWait()!.id).toBe("login-new");
  });

  it("successSelector 命中时返回成功", async () => {
    const page = makeFakePage({ visible: true });
    const result = await runWaitForLoginOnPage(page, {
      successSelector: ".user-profile",
      pollIntervalMs: 100,
      timeoutMs: 3_000,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toBe("命中 successSelector: .user-profile");
    expect(getPendingLoginWait()).toBeNull();
  });

  it("successSelector 多标签扫描:新标签命中并成为 targetPage,且回调注册新页", async () => {
    const page1 = makeFakePage({ url: "https://example.com/login" });
    const page2 = makeFakePage({ url: "https://sso.example.com/authorize", visible: true });
    page1.context = () => ({ pages: () => [page1, page2] });
    page2.context = () => ({ pages: () => [page1, page2] });
    const detected: any[] = [];
    const result = await runWaitForLoginOnPage(
      page1,
      { successSelector: ".dashboard-root", pollIntervalMs: 100, timeoutMs: 3_000 },
      (p) => detected.push(p),
    );
    expect(result.loggedIn).toBe(true);
    expect(result.targetPage).toBe(page2);
    expect(detected).toContain(page2);
  });

  it("原标签关闭时自动迁移至存活页并命中 successUrl", async () => {
    const page1 = makeFakePage({ isClosed: true, url: "https://example.com/login" });
    const page2 = makeFakePage({ url: "https://example.com/workspace" });
    page1.context = () => ({ pages: () => [page1, page2] });
    page2.context = () => ({ pages: () => [page1, page2] });
    const result = await runWaitForLoginOnPage(page1, {
      successUrl: "example\\.com/workspace",
      pollIntervalMs: 100,
      timeoutMs: 3_000,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("命中 successUrl");
    expect(result.targetPage).toBe(page2);
  });

  it("successUrl 正则匹配时返回成功", async () => {
    const page = makeFakePage({
      urlChangesAfter: 1,
      targetUrl: "https://example.com/welcome?token=abc",
    });
    const result = await runWaitForLoginOnPage(page, {
      successUrl: "example\\.com/welcome",
      pollIntervalMs: 100,
      timeoutMs: 5_000,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("命中 successUrl");
  });

  it("无用户确认且无显式条件时超时返回 loggedIn:false(不抛错)", async () => {
    const page = makeFakePage();
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 300, pollIntervalMs: 100 });
    expect(result.loggedIn).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(250);
    expect(result.detail).toContain("未在面板确认");
    expect(getPendingLoginWait()).toBeNull();
  });

  it("URL 变化/密码框消失不再自动判定完成(启发式已移除)", async () => {
    // URL 跳到非登录页、密码框也没了——只要用户没点确认、没给显式条件,就必须等到超时
    const page = makeFakePage({ urlChangesAfter: 1, targetUrl: "https://example.com/workspace" });
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 300, pollIntervalMs: 100 });
    expect(result.loggedIn).toBe(false);
  });
});

describe("waitForLoginTool fail-fast", () => {
  it("无面板且无显式条件时,启动浏览器前直接抛错并给出补参指引", async () => {
    setInteractivePanelPresent(false);
    await expect(waitForLoginTool({} as any, {})).rejects.toThrow(/successSelector|successUrl/);
  });
});
