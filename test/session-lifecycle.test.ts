// 会话标签生命周期测试:外部关页(僵尸句柄)自动摘除、getPage 存活守卫、
// browser_open 自愈换新页、tabList 附 createdAt。stub 模式照抄 context.test.ts。
import { describe, it, expect, beforeEach } from "vitest";
import { openTool, tabsTool } from "../src/browser/tools.js";
import { getPage, tabList, currentProfile, getProfileState } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { Page } from "playwright-core";

const CONFIG: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

interface FakePage extends Page {
  emitClose(): void;
  setClosed(v: boolean): void;
  failGotoOnce(): void;
}

function makeFakePage(url = "about:blank"): FakePage {
  const listeners: Record<string, (() => void)[]> = {};
  let closed = false;
  let failGoto = false;
  const page: any = {
    url: () => url,
    title: async () => "fake",
    setDefaultTimeout: () => {},
    on: (ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    },
    isClosed: () => closed,
    setClosed: (v: boolean) => {
      closed = v;
    },
    emitClose: () => {
      closed = true;
      for (const fn of listeners.close ?? []) fn();
    },
    failGotoOnce: () => {
      failGoto = true;
    },
    close: async () => {
      page.emitClose();
    },
    exposeBinding: async () => {},
    addInitScript: async () => {},
    evaluate: async () => undefined,
    goto: async (u: string) => {
      if (failGoto) {
        failGoto = false;
        throw new Error("Target page, context or browser has been closed");
      }
      url = u;
    },
  };
  return page as FakePage;
}

function installFakeBrowser() {
  const state = getProfileState(currentProfile);
  state.browser = {
    newPage: async () => makeFakePage(),
    close: async () => {},
  } as any;
  state.context = null;
  state.persistent = false;
}

beforeEach(() => {
  const state = getProfileState(currentProfile);
  state.pages = new Map();
  state.tabMeta?.clear();
  state.activeId = null;
  state.counter = 0;
  state.browser = null;
  state.context = null;
});

describe("标签生命周期(僵尸页治理)", () => {
  it("外部关页自动摘除,activeId 置 null(不静默换页)", async () => {
    installFakeBrowser();
    const a = await getPage(CONFIG);
    const state = getProfileState(currentProfile);
    expect(state.pages.size).toBe(1);
    (a as FakePage).emitClose();
    expect(state.pages.size).toBe(0);
    expect(state.activeId).toBeNull();
    expect(state.tabMeta?.size ?? 0).toBe(0);
  });

  it("关闭非活动页不影响 activeId", async () => {
    installFakeBrowser();
    const a = await getPage(CONFIG);
    await tabsTool(CONFIG, { action: "new" });
    const state = getProfileState(currentProfile);
    (a as FakePage).emitClose();
    expect(state.pages.size).toBe(1);
    expect(state.activeId).toBe(1);
  });

  it("close 监听幂等:手动删除后迟到的 close 事件不误伤", async () => {
    installFakeBrowser();
    const a = (await getPage(CONFIG)) as FakePage; // id 0
    await tabsTool(CONFIG, { action: "new" }); // id 1 active
    const state = getProfileState(currentProfile);
    state.pages.delete(0); // 模拟其他路径的手动删除(监听器未触发)
    a.emitClose(); // 迟到的 close 事件 → 监听器应因 id 已不在注册表而跳过
    expect(state.activeId).toBe(1);
    expect(state.pages.size).toBe(1);
  });

  it("tabs close 活动标签:activeId 置 null(显式恢复语义,不静默换页)", async () => {
    installFakeBrowser();
    await getPage(CONFIG); // id 0
    await tabsTool(CONFIG, { action: "new" }); // id 1 active
    const state = getProfileState(currentProfile);
    await tabsTool(CONFIG, { action: "close", id: 1 });
    expect(state.activeId).toBeNull();
    expect(state.pages.size).toBe(1); // 其余页保留
  });

  it("getPage 守卫:active 死而其他页活 → activeTabClosed 报错引导,不静默换页", async () => {
    installFakeBrowser();
    await getPage(CONFIG); // id 0
    await tabsTool(CONFIG, { action: "new" }); // id 1 active
    const state = getProfileState(currentProfile);
    (state.pages.get(1) as FakePage).setClosed(true); // 崩溃且 close 事件未派发
    await expect(getPage(CONFIG)).rejects.toMatchObject({ code: "activeTabClosed" });
    expect(state.pages.has(1)).toBe(false); // 僵尸已摘除
    expect(state.pages.size).toBe(1); // 存活页保留
  });

  it("getPage:全部页死 → 自动新建活页(原行为保留)", async () => {
    installFakeBrowser();
    const a = await getPage(CONFIG);
    (a as FakePage).emitClose();
    const b = await getPage(CONFIG);
    expect(getProfileState(currentProfile).pages.size).toBe(1);
    expect(b.url()).toBe("about:blank");
  });
});

describe("browser_open 自愈", () => {
  it("活动标签已死且有其他存活页 → 自动新建标签,返回 recovered", async () => {
    installFakeBrowser();
    await getPage(CONFIG); // id 0
    await tabsTool(CONFIG, { action: "new" }); // id 1 active
    const state = getProfileState(currentProfile);
    (state.pages.get(1) as FakePage).setClosed(true);
    const r = (await openTool(CONFIG, { url: "https://heal.example/" })) as any;
    expect(r).toMatchObject({ status: "ok", recovered: "new-tab", url: "https://heal.example/" });
  });

  it("无存活页时直接新建( getPage size===0 路径)", async () => {
    installFakeBrowser();
    const a = await getPage(CONFIG);
    (a as FakePage).emitClose();
    const r = (await openTool(CONFIG, { url: "https://fresh.example/" })) as any;
    expect(r).toMatchObject({ status: "ok", url: "https://fresh.example/" });
    expect(getProfileState(currentProfile).pages.size).toBe(1);
  });

  it("goto 竞态报 closed → 换新页重试一次成功", async () => {
    installFakeBrowser();
    const a = (await getPage(CONFIG)) as FakePage;
    a.failGotoOnce(); // 首次 goto 抛 "has been closed"
    const r = (await openTool(CONFIG, { url: "https://race.example/" })) as any;
    expect(r).toMatchObject({ status: "ok", recovered: "new-tab", url: "https://race.example/" });
  });
});

describe("tabList 健康度", () => {
  it("僵尸页(isClosed 但事件未派发)被摘除;存活页附 createdAt", async () => {
    installFakeBrowser();
    await getPage(CONFIG); // id 0
    await tabsTool(CONFIG, { action: "new" }); // id 1
    const state = getProfileState(currentProfile);
    (state.pages.get(0) as FakePage).setClosed(true);
    const tabs = (await tabList()) as any[];
    expect(tabs.length).toBe(1);
    expect(tabs[0].id).toBe(1);
    expect(typeof tabs[0].createdAt).toBe("number");
  });

  it("tabs list 返回 createdAt(tabsTool 投影)", async () => {
    installFakeBrowser();
    await tabsTool(CONFIG, { action: "new" });
    const r = (await tabsTool(CONFIG, { action: "list" })) as any;
    expect(r.tabs.length).toBe(1);
    expect(typeof r.tabs[0].createdAt).toBe("number");
  });
});
