// session 层 → screencast 推模型通知钩子测试:
// registerTabPage / 页面关闭 / setCurrentProfile 必须主动 syncTo,
// 且非当前 profile 的标签操作不触发(screencast 只跟随当前 profile 活动页)。
import { describe, expect, it, vi, beforeEach } from "vitest";

const syncMock = vi.hoisted(() => vi.fn());

vi.mock("../src/browser/session/screencast.js", () => ({
  screencastManager: { syncTo: syncMock, stop: vi.fn() },
  ScreencastManager: class {},
}));

import { registerTabPage, getProfileState, setCurrentProfile } from "../src/browser/session.js";
import type { Page } from "playwright-core";

function makePage(): { page: Page; close: () => void } {
  const closeHandlers: Array<() => void> = [];
  const page = {
    isClosed: () => false,
    on: (event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
  } as unknown as Page;
  return { page, close: () => { for (const h of [...closeHandlers]) h(); } };
}

describe("实时画面流跟随钩子(推模型)", () => {
  beforeEach(() => {
    syncMock.mockClear();
  });

  it("registerTabPage 注册当前 profile 页时 syncTo(activePage)", () => {
    const state = getProfileState("default");
    const { page } = makePage();
    const id = registerTabPage(state, page);
    expect(syncMock).toHaveBeenCalledTimes(1);
    // 通知的目标必须是刚激活的活动页
    expect(syncMock).toHaveBeenLastCalledWith(page);
    void id;
  });

  it("非当前 profile 的标签注册不触发通知", () => {
    const other = getProfileState("other-profile");
    const { page } = makePage();
    registerTabPage(other, page);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("活动页关闭(activeId 置 null)时 syncTo(null)", () => {
    const state = getProfileState("default");
    const { page, close } = makePage();
    registerTabPage(state, page);
    syncMock.mockClear();

    close();
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenLastCalledWith(null);
  });

  it("背景页关闭不改变活动页,通知仍是当前活动页(no-op 收敛)", () => {
    const state = getProfileState("default");
    const active = makePage();
    const background = makePage();
    registerTabPage(state, active.page);
    registerTabPage(state, background.page); // 注册即激活,active 变为 background
    const current = background.page;
    syncMock.mockClear();

    active.close(); // 旧活动页关闭,activeId 已指向 background
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenLastCalledWith(current);
  });

  it("setCurrentProfile 通知 screencast 跟随新 profile 活动页", () => {
    setCurrentProfile("profile-x");
    expect(syncMock).toHaveBeenCalledTimes(1);
    // 新 profile 无打开页面,应同步为 null(停流)
    expect(syncMock).toHaveBeenLastCalledWith(null);
    setCurrentProfile("default"); // 还原,避免影响其他测试
  });
});
