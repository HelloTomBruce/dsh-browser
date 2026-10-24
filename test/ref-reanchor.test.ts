// M5 SPA ref 软失效重锚定测试:remapRefs 纯逻辑 + resolveTargetLocator 的
// 降级 4(代际过期 → 重扫 → remap → 新 selector 再试)+ 单次尝试守卫。
import { describe, expect, it, vi } from "vitest";
import { resolveTargetLocator } from "../src/browser/session/target.js";
import {
  setPageRefs, pageRefsOf, pageRef, bumpPageNav, pageNavSeq,
  noteReanchorAttempt, reanchorAttempted, remapRefs,
} from "../src/browser/session/cache.js";
import type { RefEntry } from "../src/browser/types.js";
import type { Page } from "playwright-core";

describe("navSeq 代际计数", () => {
  it("bumpPageNav 单调递增,重锚定尝试标记按代际隔离", () => {
    const page: any = {};
    expect(pageNavSeq(page)).toBe(0);
    bumpPageNav(page);
    bumpPageNav(page);
    expect(pageNavSeq(page)).toBe(2);
    expect(reanchorAttempted(page)).toBe(false);
    noteReanchorAttempt(page);
    expect(reanchorAttempted(page)).toBe(true);
    bumpPageNav(page); // 新代际:尝试标记重置
    expect(reanchorAttempted(page)).toBe(false);
  });
});

describe("remapRefs 纯逻辑", () => {
  const F = (role: string, name: string, selector: string) => ({ role, name, selector });

  it("role+name 命中:沿用原 ref 编号并更新 selector/navSeq", () => {
    const old = new Map<string, RefEntry>([
      ["e1", { role: "button", name: "登录", selector: "#old-login" }],
      ["e2", { role: "textbox", name: "用户名", selector: "#old-user" }],
    ]);
    const fresh = [F("button", "登录", "#new-login"), F("textbox", "用户名", "#new-user")];
    const { merged, remapped, dropped } = remapRefs(old, fresh, 3);
    expect(remapped).toBe(2);
    expect(dropped).toBe(0);
    expect(merged.get("e1")).toMatchObject({ selector: "#new-login", navSeq: 3 });
    expect(merged.get("e2")).toMatchObject({ selector: "#new-user", navSeq: 3 });
  });

  it("名称漂移(空白/大小写变化)按去空白归一化命中并计 drifted", () => {
    const old = new Map<string, RefEntry>([["e1", { role: "button", name: "确 定", selector: "#a" }]]);
    const { merged, drifted } = remapRefs(old, [F("button", "确定", "#b")], 1);
    expect(merged.get("e1")?.selector).toBe("#b");
    expect(drifted).toBe(1);
  });

  it("页面整变(元素消失)的 ref 被删除", () => {
    const old = new Map<string, RefEntry>([["e1", { role: "button", name: "登录", selector: "#a" }]]);
    const { merged, dropped } = remapRefs(old, [F("link", "首页", "#home")], 1);
    expect(dropped).toBe(1);
    expect(merged.has("e1")).toBe(false);
  });

  it("同指纹多命中按出现顺序 zip(列表项重排不串位)", () => {
    const old = new Map<string, RefEntry>([
      ["e1", { role: "menuitem", name: "编辑", selector: "#r1-edit" }],
      ["e2", { role: "menuitem", name: "编辑", selector: "#r2-edit" }],
    ]);
    const fresh = [F("menuitem", "编辑", "#rowA-edit"), F("menuitem", "编辑", "#rowB-edit")];
    const { merged } = remapRefs(old, fresh, 1);
    expect(merged.get("e1")?.selector).toBe("#rowA-edit");
    expect(merged.get("e2")?.selector).toBe("#rowB-edit");
  });

  it("子 Frame 条目原样保留不参与重锚定", () => {
    const sub: RefEntry = { role: "button", name: "登录", selector: "#sub-login", frameIndex: 1, frameUrl: "https://x" };
    const old = new Map<string, RefEntry>([["f1:e1", sub]]);
    const { merged, remapped, dropped } = remapRefs(old, [F("button", "登录", "#main-login")], 2);
    expect(remapped).toBe(0);
    expect(dropped).toBe(0);
    expect(merged.get("f1:e1")).toBe(sub);
  });

  it("重锚定结果附带 rect/scroll(视口内元素坐标兜底续命)", () => {
    const old = new Map<string, RefEntry>([["e1", { role: "button", name: "登录", selector: "#a" }]]);
    const fresh = [{ role: "button", name: "登录", selector: "#b", rect: { x: 1, y: 2, w: 3, h: 4 }, scroll: { x: 0, y: 0 } }];
    const { merged } = remapRefs(old, fresh, 1);
    expect(merged.get("e1")?.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(merged.get("e1")?.scroll).toEqual({ x: 0, y: 0 });
  });
});

describe("resolveTargetLocator 降级 4(软失效重锚定)", () => {
  function staleRefPage(freshScan: any) {
    // 路径校验失败(locator.evaluate false)→ 弹窗/role 降级 count=0 → 无 rect
    // → 触发重锚定:page.evaluate(scanAllInteractive) 返回 freshScan
    const locMock: any = {
      first: () => locMock,
      count: vi.fn().mockResolvedValue(1), // 路径 count>0 → 走校验
      evaluate: vi.fn().mockResolvedValue(false), // 校验不过
    };
    // 重锚定后的新 selector locator(count=1)
    const reanchoredLoc: any = { first: () => reanchoredLoc, count: vi.fn().mockResolvedValue(1) };
    const page: any = {
      locator: vi.fn().mockImplementation((sel: string) => (sel === "#new-login" ? reanchoredLoc : locMock)),
      evaluate: vi.fn().mockResolvedValue(freshScan),
      getByRole: vi.fn().mockReturnValue({ first: () => ({ count: vi.fn().mockResolvedValue(0) }) }),
    };
    return { page, reanchoredLoc };
  }

  it("代际过期的 ref 定位失败后重扫 remap,按新 selector 命中", async () => {
    const { page, reanchoredLoc } = staleRefPage({
      elements: [{ role: "button", name: "登录", selector: "#new-login" }],
      truncated: false,
    });
    bumpPageNav(page); // 代际 1:旧 ref(navSeq 0)过期
    setPageRefs(page, new Map([["e1", { role: "button", name: "登录", selector: "#old-login", navSeq: 0 }]]));
    const res = await resolveTargetLocator(page, { ref: "e1" });
    expect(res.locator).toBe(reanchoredLoc);
    // 注册表已 remap:e1 指向新 selector 且代际对齐
    expect(pageRef(page, "e1")).toMatchObject({ selector: "#new-login", navSeq: 1 });
  });

  it("整页跳转(元素消失):remap 后仍无该 ref,抛原「已失效」错误", async () => {
    const { page } = staleRefPage({
      elements: [{ role: "link", name: "首页", selector: "#home" }],
      truncated: false,
    });
    bumpPageNav(page);
    setPageRefs(page, new Map([["e1", { role: "button", name: "登录", selector: "#old", navSeq: 0 }]]));
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("ref e1 已失效");
    expect(pageRefsOf(page).has("e1")).toBe(false); // 已被 remap 清除
  });

  it("同代际只重锚定一次(第二次失败不再全页扫描)", async () => {
    const { page } = staleRefPage({ elements: [], truncated: false });
    bumpPageNav(page);
    setPageRefs(page, new Map([
      ["e1", { role: "button", name: "登录", selector: "#old", navSeq: 0 }],
      ["e2", { role: "button", name: "注册", selector: "#old2", navSeq: 0 }],
    ]));
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("已失效");
    const evaluateCalls = (page.evaluate as any).mock.calls.length; // 重锚定扫描 1 + 失败遥测探测 1
    await expect(resolveTargetLocator(page, { ref: "e2" })).rejects.toThrow("已失效");
    // 第二次失败只多一次失败遥测探测(+1),不再全页重扫(否则会是 +2)
    expect((page.evaluate as any).mock.calls.length).toBe(evaluateCalls + 1);
  });

  it("代际未过期(正常 ref)失败不走重锚定", async () => {
    const { page } = staleRefPage({ elements: [{ role: "button", name: "登录", selector: "#new" }], truncated: false });
    setPageRefs(page, new Map([["e1", { role: "button", name: "登录", selector: "#old", navSeq: 0 }]]));
    // 未 bump:navSeq 0 === pageNavSeq 0 → 正常 ref,失败直接抛错;
    // 唯一的 evaluate 是失败遥测探测(非重锚定扫描)
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("已失效");
    expect((page.evaluate as any).mock.calls.length).toBe(1);
  });

  it("扫描截断(超大页面)不重锚定,维持原错误", async () => {
    const { page } = staleRefPage({ elements: [], truncated: true });
    bumpPageNav(page);
    setPageRefs(page, new Map([["e1", { role: "button", name: "登录", selector: "#old", navSeq: 0 }]]));
    await expect(resolveTargetLocator(page, { ref: "e1" })).rejects.toThrow("已失效");
    expect(pageRefsOf(page).get("e1")?.selector).toBe("#old"); // 注册表未被破坏
  });
});
