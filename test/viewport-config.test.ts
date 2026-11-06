// viewport 配置测试:viewportOptionOf 形状校验、launch/newPage/browser_context
// 三条路径都把 viewport 选项注入到 Playwright context 级 API。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { viewportOptionOf, newPage, getProfileState, currentProfile } from "../src/browser/session.js";
import { contextTool } from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

// vi.mock 提升后同文件只有一个 factory 生效:用 vi.hoisted 共享捕获状态
const hoisted = vi.hoisted(() => ({
  launchPersistentContextArgs: [] as any[],
  launchArgs: [] as any[],
}));

vi.mock("playwright-core", () => ({
  chromium: {
    launchPersistentContext: async (...args: any[]) => {
      hoisted.launchPersistentContextArgs.push(args);
      return {
        pages: () => [],
        newPage: async () => makeFakePage(),
        close: async () => {},
      };
    },
    launch: async (...args: any[]) => {
      hoisted.launchArgs.push(args);
      return {
        newPage: async () => makeFakePage(),
        close: async () => {},
      };
    },
  },
}));

function makeFakePage(): any {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    url: () => "about:blank",
    title: async () => "fake",
    setDefaultTimeout: () => {},
    on: (ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    },
    isClosed: () => false,
    close: async () => {},
    exposeBinding: async () => {},
    addInitScript: async () => {},
    evaluate: async () => undefined,
  };
}

const BASE: BrowserConfig = { channel: "chromium", headless: true, timeoutMs: 5000 };

beforeEach(() => {
  hoisted.launchPersistentContextArgs.length = 0;
  hoisted.launchArgs.length = 0;
  const state = getProfileState(currentProfile);
  state.pages = new Map();
  state.tabMeta?.clear();
  state.activeId = null;
  state.counter = 0;
  state.browser = null;
  state.context = null;
  state.persistent = false;
});

describe("viewportOptionOf", () => {
  it("缺省 → {}(Playwright 默认 1280×720 固定仿真,行为不变)", () => {
    expect(viewportOptionOf({})).toEqual({});
    expect(viewportOptionOf({ viewport: undefined })).toEqual({});
  });

  it('"window" → viewport: null(视口跟随窗口)', () => {
    expect(viewportOptionOf({ viewport: "window" })).toEqual({ viewport: null });
  });

  it("{ width, height } → 固定视口", () => {
    expect(viewportOptionOf({ viewport: { width: 1920, height: 1080 } })).toEqual({
      viewport: { width: 1920, height: 1080 },
    });
  });

  it("非法形状抛中文配置错误", () => {
    expect(() => viewportOptionOf({ viewport: "fullscreen" as any })).toThrow(/viewport/);
    expect(() => viewportOptionOf({ viewport: { width: 0, height: 100 } })).toThrow(/viewport/);
    expect(() => viewportOptionOf({ viewport: { width: 100 } as any })).toThrow(/viewport/);
    expect(() => viewportOptionOf({ viewport: 42 as any })).toThrow(/viewport/);
  });
});

describe("viewport 注入启动链路", () => {
  it("持久模式:launchPersistentContext 收到 viewport 选项", async () => {
    const { launchProfile } = await import("../src/browser/session.js");
    await launchProfile(currentProfile, {
      ...BASE,
      userDataDir: "/tmp/dsh-viewport-test",
      viewport: "window",
    });
    expect(hoisted.launchPersistentContextArgs.length).toBe(1);
    expect(hoisted.launchPersistentContextArgs[0][1]).toMatchObject({ viewport: null });
  });

  it("非持久模式:browser.newPage 收到 viewport 选项(viewport 是 context 级)", async () => {
    const captured: any[] = [];
    const state = getProfileState(currentProfile);
    state.browser = {
      newPage: async (opts: any) => {
        captured.push(opts);
        return makeFakePage();
      },
      close: async () => {},
    } as any;
    await newPage({ ...BASE, viewport: { width: 1600, height: 900 } });
    expect(captured).toEqual([{ viewport: { width: 1600, height: 900 } }]);
  });

  it("非持久模式缺省:newPage 不传 viewport(保持 Playwright 默认)", async () => {
    const captured: any[] = [];
    const state = getProfileState(currentProfile);
    state.browser = {
      newPage: async (opts: any) => {
        captured.push(opts);
        return makeFakePage();
      },
      close: async () => {},
    } as any;
    await newPage(BASE);
    expect(captured).toEqual([{}]);
  });

  it("browser_context new:newContext 收到 viewport 选项", async () => {
    const captured: any[] = [];
    const state = getProfileState(currentProfile);
    state.browser = {
      newContext: async (opts: any) => {
        captured.push(opts);
        return {
          newPage: async () => makeFakePage(),
          close: async () => {},
        };
      },
      newPage: async () => makeFakePage(),
      close: async () => {},
    } as any;
    await contextTool({ ...BASE, viewport: "window" }, { action: "new", name: "vp-test" });
    expect(captured).toEqual([{ viewport: null }]);
    await contextTool(BASE, { action: "close", name: "vp-test" });
  });

  it("非法 viewport 在启动前快速失败,不被候选重试吞成「启动失败」", async () => {
    const { launchProfile } = await import("../src/browser/session.js");
    await expect(
      launchProfile(currentProfile, { ...BASE, viewport: "fullscreen" as any }),
    ).rejects.toThrow(/config\.viewport 无效/);
    // 一个候选都不应尝试
    expect(hoisted.launchArgs.length).toBe(0);
    expect(hoisted.launchPersistentContextArgs.length).toBe(0);
  });
});
