// browser_pause_for_human 单元测试:用 fake page 注入 runPauseOnPage,
// 覆盖缺参数、successSelector 命中、默认条件(URL 变化)、超时、
// 暂停状态设置/清理 五个分支。不启动真实浏览器。
import { describe, it, expect, afterEach } from "vitest";
import { runPauseOnPage } from "../src/browser/tools.js";
import { currentPause, clearPauseInstruction } from "../src/browser/session.js";

interface FakePageOpts {
  /** locator().first().isVisible() 的返回值。 */
  visible?: boolean;
  /** waitForTimeout 被调用多少次后 URL 发生变化(默认永不)。 */
  urlChangesAfter?: number;
  /** evaluate 返回的页面签名(默认常量)。 */
  signature?: string;
  /** evaluate 抛错(模拟导航中页面销毁)。 */
  evaluateThrows?: boolean;
  /** url() 抛错。 */
  urlThrows?: boolean;
}

function makeFakePage(opts: FakePageOpts = {}) {
  let ticks = 0;
  const startUrl = "https://example.com/login";
  return {
    url: () => {
      if (opts.urlThrows) throw new Error("page gone");
      return ticks >= (opts.urlChangesAfter ?? Number.POSITIVE_INFINITY) ? "https://example.com/done" : startUrl;
    },
    title: async () => "示例页",
    evaluate: async () => {
      if (opts.evaluateThrows) throw new Error("navigation");
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
  } as any;
}

afterEach(() => {
  clearPauseInstruction();
});

describe("runPauseOnPage", () => {
  it("缺少 instruction 直接报错(不进入轮询)", async () => {
    await expect(runPauseOnPage(makeFakePage(), {})).rejects.toThrow("instruction");
    await expect(runPauseOnPage(makeFakePage(), { instruction: "   " })).rejects.toThrow("instruction");
    expect(currentPause()).toBeNull();
  });

  it("successSelector 可见时完成", async () => {
    const result = await runPauseOnPage(makeFakePage({ visible: true }), {
      instruction: "请输入验证码",
      successSelector: "#done",
    });
    expect(result.completed).toBe(true);
    expect(result.detail).toBe("人工操作完成");
    expect(currentPause()).toBeNull(); // 结束后清理
  });

  it("默认条件:URL 变化即完成,等待期间暂停状态可见", async () => {
    let seenDuringWait: string | null = null;
    const page = makeFakePage({ urlChangesAfter: 1 });
    const origWait = page.waitForTimeout;
    page.waitForTimeout = async (ms: number) => {
      if (currentPause() !== null && seenDuringWait === null) {
        seenDuringWait = currentPause()!.instruction;
      }
      return origWait(ms);
    };
    const result = await runPauseOnPage(page, { instruction: "请完成二次确认" });
    expect(seenDuringWait).toBe("请完成二次确认");
    expect(result.completed).toBe(true);
    expect(result.waitedMs).toBeGreaterThanOrEqual(0);
  });

  it("默认条件:页面签名变化(无 URL 变化)也完成", async () => {
    const page = makeFakePage({ signature: "sig-1" });
    let polls = 0;
    const origEval = page.evaluate;
    page.evaluate = async (...args: unknown[]) => {
      polls += 1;
      // 首次取签名后,第三次起签名变化(中间隔 waitForTimeout)
      (page as any).__sig = polls <= 1 ? "sig-1" : polls >= 3 ? "sig-2" : "sig-1";
      return (page as any).__sig;
    };
    void origEval;
    const result = await runPauseOnPage(page, { instruction: "请操作" });
    expect(result.completed).toBe(true);
  });

  it("超时返回 completed:false 并带超时详情", async () => {
    const result = await runPauseOnPage(makeFakePage(), {
      instruction: "请输入短信验证码",
      timeoutMs: 1_000,
    });
    expect(result.completed).toBe(false);
    expect(result.detail).toContain("超时");
    expect(result.waitedMs).toBeGreaterThanOrEqual(900);
    expect(currentPause()).toBeNull();
  });

  it("successUrl 正则命中完成", async () => {
    const result = await runPauseOnPage(makeFakePage({ urlChangesAfter: 1 }), {
      instruction: "请登录",
      successUrl: "example\\.com/done",
    });
    expect(result.completed).toBe(true);
  });

  it("检查条件出错不中断等待(记录 detail)", async () => {
    const page = makeFakePage({ urlThrows: true });
    const result = await runPauseOnPage(page, {
      instruction: "请操作",
      timeoutMs: 1_000,
    });
    expect(result.completed).toBe(false);
    expect(result.detail).toContain("检查完成条件出错");
  });
});
