// browser_context 单元测试:用 fake browser/context/page 注入 profileStates,
// 覆盖 list / new(自动命名 + 重名报错)/ switch(激活 + 组内页全关后新开)/
// close(移除页 + 激活回退)/ 持久模式拒绝。
import { describe, it, expect, beforeEach } from "vitest";
import { contextTool } from "../src/browser/tools.js";
import { profileStates, namedContextsOf, currentProfile, getProfileState } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { Page, Browser, BrowserContext } from "playwright-core";

const CONFIG: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

function makeFakePage(url = "about:blank"): Page {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    url: () => url,
    title: async () => "fake",
    setDefaultTimeout: () => {},
    on: (ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    },
    emitClose() {
      for (const fn of listeners.close ?? []) fn();
    },
    exposeBinding: async () => {},
    addInitScript: async () => {},
    evaluate: async () => undefined,
    goto: async (u: string) => {
      url = u;
    },
  } as any;
}

function installFakeBrowser(persistent = false) {
  const state = getProfileState(currentProfile);
  const contexts: BrowserContext[] = [];
  const browser: Browser = {
    newContext: async () => {
      const pages: Page[] = [];
      const ctx = {
        newPage: async () => {
          const p = makeFakePage();
          pages.push(p);
          return p;
        },
        close: async () => {
          for (const p of pages) (p as any).emitClose?.();
        },
        pages: () => pages,
      } as any;
      contexts.push(ctx);
      return ctx;
    },
    close: async () => {},
  } as any;
  state.browser = persistent ? null : browser;
  state.context = persistent ? ({ close: async () => {} } as any) : null;
  state.persistent = persistent;
  return { contexts };
}

beforeEach(() => {
  // 清空当前 profile 状态与命名上下文
  const state = getProfileState(currentProfile);
  state.pages = new Map();
  state.activeId = null;
  state.counter = 0;
  state.browser = null;
  state.context = null;
  namedContextsOf().clear();
  void profileStates;
});

describe("contextTool", () => {
  it("list 空时返回空数组", async () => {
    const r = (await contextTool(CONFIG, { action: "list" })) as any;
    expect(r.contexts).toEqual([]);
    expect(r.profile).toBe(currentProfile);
  });

  it("new 创建独立 context + 页注册进标签表并激活;自动命名递增", async () => {
    const fake = installFakeBrowser();
    const a = (await contextTool(CONFIG, { action: "new" })) as any;
    const b = (await contextTool(CONFIG, { action: "new", name: "biz" })) as any;
    expect(a.created).toBe("ctx-1");
    expect(b.created).toBe("biz");
    expect(fake.contexts.length).toBe(2); // 两个独立 BrowserContext(cookies 隔离)
    const state = getProfileState(currentProfile);
    expect(state.pages.size).toBe(2);
    expect(state.activeId).not.toBeNull();
  });

  it("new 重名报错并提示先 close", async () => {
    installFakeBrowser();
    await contextTool(CONFIG, { action: "new", name: "x" });
    await expect(contextTool(CONFIG, { action: "new", name: "x" })).rejects.toThrow(/已存在/);
  });

  it("switch 激活目标组的页;组内页全关后在原 context 新开(cookie 保留)", async () => {
    installFakeBrowser();
    await contextTool(CONFIG, { action: "new", name: "a" });
    await contextTool(CONFIG, { action: "new", name: "b" });
    const state = getProfileState(currentProfile);
    // 切回 a
    const r = (await contextTool(CONFIG, { action: "switch", name: "a" })) as any;
    expect(r.switched).toBe("a");
    expect(state.activeId).not.toBeNull();
    // 关掉 a 组的活动页(模拟用户关标签)
    const pageA = state.pages.get(state.activeId!)!;
    (pageA as any).emitClose?.();
    state.pages.delete(state.activeId!);
    state.activeId = null;
    // 再切 a:组内无存活页 → 原 context 新开
    const r2 = (await contextTool(CONFIG, { action: "switch", name: "a" })) as any;
    expect(r2.switched).toBe("a");
    expect(r2.pages).toBe(1);
    expect(state.activeId).not.toBeNull();
  });

  it("close 整组关闭:页移出标签表,激活回退到剩余页", async () => {
    installFakeBrowser();
    await contextTool(CONFIG, { action: "new", name: "a" });
    await contextTool(CONFIG, { action: "new", name: "b" });
    const state = getProfileState(currentProfile);
    const ids = Array.from(state.pages.keys());
    // 激活在 b(最后创建),关 b
    const r = (await contextTool(CONFIG, { action: "close", name: "b" })) as any;
    expect(r.closed).toBe("b");
    expect(state.pages.has(ids[1])).toBe(false);
    expect(state.pages.has(ids[0])).toBe(true); // a 组保留
    expect(state.activeId).toBe(ids[0]); // 回退
    expect((await contextTool(CONFIG, { action: "list" })) as any).toMatchObject({
      contexts: [{ name: "a", pages: 1 }],
    });
  });

  it("switch/close 不存在的名字报错并列出已有", async () => {
    installFakeBrowser();
    await expect(contextTool(CONFIG, { action: "switch", name: "nope" })).rejects.toThrow(/不存在/);
    await expect(contextTool(CONFIG, { action: "close", name: "" })).rejects.toThrow(/name/);
  });

  it("持久模式(userDataDir)拒绝并建议 profiles", async () => {
    installFakeBrowser(true);
    await expect(contextTool(CONFIG, { action: "new" })).rejects.toThrow(/持久模式/);
  });

  it("未知 action 报错", async () => {
    await expect(contextTool(CONFIG, { action: "boom" })).rejects.toThrow(/未知 action/);
  });
});
