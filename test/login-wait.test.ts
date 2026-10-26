// browser_wait_for_login 单元测试:用 fake page 注入 runWaitForLoginOnPage,
// 覆盖:
//   1. 提示语同步:instruction 设置至 currentPause 并在完成后清理;
//   2. successSelector 命中完成;
//   3. successUrl 正则匹配完成;
//   4. 默认条件:URL 离开登录页(非 AUTH 特征)完成;
//   5. 默认条件:URL 变更仍在 AUTH 路径但密码框已消除(完成表单)完成;
//   6. 默认条件:SPA 场景 URL 未变但密码框消除完成;
//   7. 默认条件:SPA 场景 URL 未变但页面签名变化完成;
//   8. 存活标签感知:原标签关闭时自动迁移至存活页完成;
//   9. 超时返回 loggedIn:false 与超时 detail。
import { describe, it, expect, afterEach } from "vitest";
import { runWaitForLoginOnPage } from "../src/browser/tools.js";
import { currentPause, clearPauseInstruction } from "../src/browser/session.js";

interface FakePageOpts {
  visible?: boolean;
  url?: string;
  urlChangesAfter?: number;
  targetUrl?: string;
  signature?: string;
  hasPassword?: boolean;
  hasPasswordAfter?: number;
  evaluateThrows?: boolean;
  urlThrows?: boolean;
  isClosed?: boolean;
  contextPages?: any[];
}

function makeFakePage(opts: FakePageOpts = {}) {
  let ticks = 0;
  const startUrl = opts.url ?? "https://example.com/login";
  let closed = opts.isClosed ?? false;

  const page = {
    url: () => {
      if (opts.urlThrows) throw new Error("page gone");
      return ticks >= (opts.urlChangesAfter ?? Number.POSITIVE_INFINITY)
        ? opts.targetUrl ?? "https://example.com/dashboard"
        : startUrl;
    },
    title: async () => "示例登录页",
    isClosed: () => closed,
    evaluate: async (fn: any) => {
      if (opts.evaluateThrows) throw new Error("navigation error");
      const fnStr = typeof fn === "string" ? fn : fn.toString();
      if (fnStr.includes("input[type=\"password\"]")) {
        if (opts.hasPasswordAfter !== undefined) {
          return ticks < opts.hasPasswordAfter;
        }
        return opts.hasPassword ?? true;
      }
      return opts.signature ?? "sig-constant";
    },
    waitForTimeout: async () => {
      ticks += 1;
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

afterEach(() => {
  clearPauseInstruction();
});

describe("runWaitForLoginOnPage", () => {
  it("默认 instruction 生效，并在等待期间设置 currentPause，结束后清理", async () => {
    let seenDuringWait: string | null = null;
    const page = makeFakePage({ urlChangesAfter: 1 });
    const origWait = page.waitForTimeout;
    page.waitForTimeout = async (ms: number) => {
      if (currentPause() !== null && seenDuringWait === null) {
        seenDuringWait = currentPause()!.instruction;
      }
      return origWait(ms);
    };

    const result = await runWaitForLoginOnPage(page, { pollIntervalMs: 50 });
    expect(seenDuringWait).toBe("请在浏览器窗口中完成登录");
    expect(result.loggedIn).toBe(true);
    expect(currentPause()).toBeNull();
  });

  it("自定义 instruction 生效", async () => {
    let seenInstruction = "";
    let ticks = 0;
    const page = makeFakePage();
    page.locator = () => ({
      first: () => ({
        isVisible: async () => ticks >= 1,
      }),
    });
    const origWait = page.waitForTimeout;
    page.waitForTimeout = async (ms: number) => {
      ticks += 1;
      seenInstruction = currentPause()?.instruction ?? "";
      return origWait(ms);
    };

    const result = await runWaitForLoginOnPage(page, {
      instruction: "请扫码登录微信公众号",
      successSelector: "#avatar",
      pollIntervalMs: 50,
    });
    expect(seenInstruction).toBe("请扫码登录微信公众号");
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("#avatar");
  });

  it("successSelector 命中时立即返回成功", async () => {
    const page = makeFakePage({ visible: true });
    const result = await runWaitForLoginOnPage(page, {
      successSelector: ".user-profile",
      pollIntervalMs: 50,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toBe("命中 successSelector: .user-profile");
  });

  it("successUrl 正则匹配时立即返回成功", async () => {
    const page = makeFakePage({
      urlChangesAfter: 1,
      targetUrl: "https://example.com/welcome?token=abc",
    });
    const result = await runWaitForLoginOnPage(page, {
      successUrl: "example\\.com/welcome",
      pollIntervalMs: 50,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("命中 successUrl");
  });

  it("默认条件: URL 离开登录页跳转至非鉴权页时判定成功", async () => {
    const page = makeFakePage({
      urlChangesAfter: 1,
      targetUrl: "https://example.com/workspace",
    });
    const result = await runWaitForLoginOnPage(page, { pollIntervalMs: 50 });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("https://example.com/workspace");
  });

  it("默认条件: URL 变更但仍处于 auth 路径且密码框仍在时，不提前误判", async () => {
    const page = makeFakePage({
      urlChangesAfter: 1,
      targetUrl: "https://example.com/auth/step2",
      hasPassword: true,
    });
    // 限制仅等待 300ms
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 300, pollIntervalMs: 50 });
    expect(result.loggedIn).toBe(false);
    expect(result.detail).toContain("超时");
  });

  it("默认条件: URL 仍处 auth 路径但密码框已消除，判定表单已通过", async () => {
    const page = makeFakePage({
      urlChangesAfter: 1,
      targetUrl: "https://example.com/auth/mfa",
      hasPassword: true,
      hasPasswordAfter: 1,
    });
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 1000, pollIntervalMs: 50 });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("密码输入框已消除");
  });

  it("默认条件: SPA 场景 URL 未变，密码框消除判定成功", async () => {
    const page = makeFakePage({
      url: "https://example.com/app",
      hasPassword: true,
      hasPasswordAfter: 1,
    });
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 1000, pollIntervalMs: 50 });
    expect(result.loggedIn).toBe(true);
    expect(result.detail).toContain("SPA 登录完成");
  });

  it("多标签页感知: 原标签关闭时自动迁移至存活新标签页完成", async () => {
    const page1 = makeFakePage({ url: "https://example.com/login" });
    const page2 = makeFakePage({
      url: "https://example.com/dashboard",
      visible: true,
    });
    page1.context = () => ({
      pages: () => [page1, page2],
    });
    page2.context = () => ({
      pages: () => [page1, page2],
    });

    // 第一次轮询后关闭 page1
    const origWait = page1.waitForTimeout;
    page1.waitForTimeout = async (ms: number) => {
      page1._setClosed(true);
      return origWait(ms);
    };

    const result = await runWaitForLoginOnPage(page1, {
      successSelector: ".dashboard-root",
      pollIntervalMs: 50,
    });
    expect(result.loggedIn).toBe(true);
    expect(result.targetPage).toBe(page2);
  });

  it("超时返回 loggedIn:false 并包含等待毫秒数与 detail", async () => {
    const page = makeFakePage();
    const result = await runWaitForLoginOnPage(page, { timeoutMs: 300, pollIntervalMs: 50 });
    expect(result.loggedIn).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(250);
    expect(result.detail).toContain("等待登录超时");
  });
});
