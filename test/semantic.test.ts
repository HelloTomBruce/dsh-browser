// browser_what 语义定位单元测试:候选排序纯逻辑 + resolveSemanticTarget
// 编排(弹窗优先/可见优先/ref 注册)。页内 walker 打分依赖浏览器,不在单测范围。
import { describe, it, expect, vi } from "vitest";
import {
  resolveSemanticTarget,
  semanticMissCandidates,
  semanticMissMessage,
} from "../src/browser/session/semantic.js";
import { resolveTargetLocator } from "../src/browser/session/target.js";
import { pageRefsOf } from "../src/browser/session/cache.js";
import type { Page } from "playwright-core";

function scanResult(matches: any[], candidates: any[] = []) {
  return { matches, candidates, scanned: matches.length + candidates.length };
}

function mockPage(scan: any): Page {
  const locatorMock: any = { first: () => locatorMock };
  const page: any = {
    evaluate: vi.fn().mockResolvedValue(scan),
    locator: vi.fn().mockReturnValue(locatorMock),
    getByRole: vi.fn(),
  };
  return page as Page;
}

describe("semanticMissCandidates / semanticMissMessage", () => {
  const cands = [
    { role: "button", name: "提交订单", selector: "#a" },
    { role: "button", name: "提交并保存", selector: "#b" },
    { role: "link", name: "登出", selector: "#c" },
    { role: "textbox", name: "订单备注", selector: "#d" },
  ];

  it("按公共子串分数取 top5,无公共子串的过滤", () => {
    const out = semanticMissCandidates("提交订单", cands);
    expect(out.length).toBe(3); // 「登出」无公共子串
    expect(out[0]).toMatchObject({ name: "提交订单", selector: "#a" });
    expect(out.every((c) => c.score >= 2)).toBe(true);
  });

  it("保留 selector 供二次定位", () => {
    const out = semanticMissCandidates("提交订单", cands);
    expect(out[0].selector).toBe("#a");
  });

  it("错误消息内嵌候选表", () => {
    const msg = semanticMissMessage({ what: "提交订单", candidates: semanticMissCandidates("提交订单", cands) });
    expect(msg).toContain('what="提交订单"');
    expect(msg).toContain('button "提交订单"');
  });

  it("零候选时给出指引", () => {
    const msg = semanticMissMessage({ what: "不存在", candidates: [] });
    expect(msg).toContain("iframe");
  });
});

describe("resolveSemanticTarget 编排", () => {
  it("命中:返回 TargetResolution 并把命中注册成 ref", async () => {
    const scan = scanResult([
      { role: "button", name: "登录", selector: "#login", text: "登录", visible: true, inDialog: false, score: 153, ancestors: [] },
      { role: "button", name: "登录并跳转", selector: "#login2", text: "登录并跳转", visible: true, inDialog: false, score: 106, ancestors: [] },
    ]);
    const page = mockPage(scan);
    const res: any = await resolveSemanticTarget(page, "登录");
    expect(res.locator).toBeDefined();
    expect(res.isIFrame).toBe(false);
    expect(res.matchedCount).toBe(2);
    expect(res.entry).toMatchObject({ role: "button", name: "登录", selector: "#login" });
    // 注册表里能查到两个新 ref
    const refs = pageRefsOf(page);
    expect(refs.size).toBe(2);
  });

  it("弹窗内命中优先于弹窗外(排序由页内完成,此处验证直接取 matches[0])", async () => {
    const scan = scanResult([
      { role: "button", name: "确定", selector: "#in-dialog", text: "确定", visible: true, inDialog: true, score: 153, ancestors: [] },
    ]);
    const page = mockPage(scan);
    const res: any = await resolveSemanticTarget(page, "确定");
    expect(res.entry?.selector).toBe("#in-dialog");
  });

  it("零命中:返回带候选的 SemanticMiss", async () => {
    const page = mockPage(scanResult([], [
      { role: "button", name: "提交订单", selector: "#a" },
    ]));
    const res: any = await resolveSemanticTarget(page, "提交订单");
    expect(res.candidates).toBeDefined();
    expect(res.candidates[0]).toMatchObject({ name: "提交订单" });
  });

  it("evaluate 失败时静默返回零候选(页面导航中不误伤)", async () => {
    const page: any = { evaluate: vi.fn().mockRejectedValue(new Error("nav")), locator: vi.fn() };
    const res: any = await resolveSemanticTarget(page as Page, "任意");
    expect(res.candidates).toEqual([]);
  });
});

describe("resolveTargetLocator 的 what 分支", () => {
  it("what 命中走语义解析;selector/ref/row 优先级高于 what", async () => {
    const scan = scanResult([
      { role: "button", name: "登录", selector: "#login", text: "登录", visible: true, inDialog: false, score: 153, ancestors: [] },
    ]);
    const page = mockPage(scan);
    const res = await resolveTargetLocator(page, { what: "登录" });
    expect(res.isIFrame).toBe(false);
    // selector 仍然优先:what 不触发语义扫描
    const page2 = mockPage(scanResult([]));
    const locatorMock: any = { first: () => locatorMock };
    (page2 as any).locator = vi.fn().mockReturnValue(locatorMock);
    await resolveTargetLocator(page2, { what: "登录", selector: "#x" });
    expect((page2 as any).evaluate).not.toHaveBeenCalled();
  });

  it("what 零命中且 role 兜底也失败:抛出含候选的错误消息", async () => {
    const byRoleLoc: any = { first: () => byRoleLoc, count: vi.fn().mockResolvedValue(0) };
    const page: any = {
      evaluate: vi.fn().mockResolvedValue(scanResult([], [
        { role: "button", name: "提交订单", selector: "#a" },
      ])),
      locator: vi.fn(),
      getByRole: vi.fn().mockReturnValue(byRoleLoc),
    };
    await expect(resolveTargetLocator(page as Page, { what: "提交订单" })).rejects.toThrow('what="提交订单"');
  });

  it("what 零命中但 getByRole 兜底命中:返回该 locator", async () => {
    const byRoleLoc: any = { first: () => byRoleLoc, count: vi.fn().mockResolvedValue(1) };
    const page: any = {
      evaluate: vi.fn().mockResolvedValue(scanResult([])),
      locator: vi.fn(),
      getByRole: vi.fn().mockReturnValue(byRoleLoc),
    };
    const res = await resolveTargetLocator(page as Page, { what: "登录" });
    expect(res.locator).toBe(byRoleLoc);
    expect(res.matchedCount).toBe(1);
  });

  it("空 what 不触发语义分支(回落既有错误)", async () => {
    const page: any = {};
    await expect(resolveTargetLocator(page as Page, { what: "  " })).rejects.toThrow("需要 selector 或 ref");
  });
});
