// browser_find 纯逻辑单元测试:ref 增量分配(assignRefs)与零命中候选
// (lcsScore / topSuggestions)。页内 walker 依赖浏览器,不在单测范围。
import { describe, it, expect } from "vitest";
import { assignRefs, lcsScore, topSuggestions } from "../src/browser/tools.js";
import type { RefEntry } from "../src/browser/types.js";

function entry(role: string, name: string, selector: string): RefEntry {
  return { role, name, selector };
}

const M = (role: string, name: string, selector: string) => ({
  role,
  name,
  selector,
  ancestors: [] as string[],
});

describe("assignRefs", () => {
  it("空注册表从 e1 开始编号", () => {
    const { withRefs, merged } = assignRefs(new Map(), [M("button", "登录", "#login")], 200);
    expect(withRefs).toEqual([{ ref: "e1", role: "button", name: "登录", selector: "#login", ancestors: [] }]);
    expect(merged.get("e1")).toEqual(entry("button", "登录", "#login"));
  });

  it("沿用既有编号继续,不与上次快照冲突,且保留旧 ref", () => {
    const existing = new Map<string, RefEntry>([
      ["e1", entry("textbox", "用户名", "#u")],
      ["e3", entry("link", "首页", "#home")],
    ]);
    const { withRefs, merged } = assignRefs(existing, [M("button", "提交", "#submit")], 200);
    expect(withRefs[0].ref).toBe("e4");
    expect(merged.get("e1")).toBeDefined(); // 旧 ref 保留
    expect(merged.get("e3")).toBeDefined();
    expect(merged.get("e4")).toEqual(entry("button", "提交", "#submit"));
  });

  it("超过 maxRefs 截断并标 truncated", () => {
    const existing = new Map<string, RefEntry>([["e2", entry("link", "a", "#a")]]);
    const matches = [M("button", "1", "#1"), M("button", "2", "#2")];
    // maxRefs=2:加入第 1 个后 merged.size=2,第 2 个放不下 → 只注册 1 个并截断
    const { withRefs, truncated } = assignRefs(existing, matches, 2);
    expect(withRefs.length).toBe(1);
    expect(withRefs[0].ref).toBe("e3");
    expect(truncated).toBe(true);
  });

  it("非 eN 形态的脏 key 不影响编号推算", () => {
    const existing = new Map<string, RefEntry>([["weird", entry("link", "x", "#x")]]);
    const { withRefs } = assignRefs(existing, [M("button", "y", "#y")], 200);
    expect(withRefs[0].ref).toBe("e1");
  });
});

describe("lcsScore / topSuggestions", () => {
  it("公共子串计分,大小写不敏感", () => {
    expect(lcsScore("登录", "登录")).toBe(2);
    expect(lcsScore("Submit", "submit")).toBe(6);
    expect(lcsScore("提交订单", "提交")).toBe(2);
    expect(lcsScore("abc", "xyz")).toBe(0);
    expect(lcsScore("", "abc")).toBe(0);
  });

  it("topSuggestions 按分数排序取 top5,过滤无公共子串的", () => {
    const cands = [
      { role: "button", name: "提交并保存" },   // score 2(「提交」)
      { role: "button", name: "提交订单" },     // score 4(整串命中)
      { role: "link", name: "登出" },           // score 0 → 过滤
      { role: "textbox", name: "订单备注" },    // score 2(「订单」)
      { role: "button", name: "提交" },         // score 2
    ];
    const out = topSuggestions("提交订单", cands);
    expect(out.length).toBe(4); // 「登出」被过滤
    expect(out[0]).toMatchObject({ name: "提交订单", score: 4 }); // 分数最高排最前
    expect(out.every((s) => s.score >= 2)).toBe(true);
  });

  it("短 query(≤3 字符)阈值降为 1,仍能给出候选", () => {
    const out = topSuggestions("搜", [{ role: "textbox", name: "搜索商品" }]);
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({ role: "textbox", name: "搜索商品" });
  });

  it("无相近候选返回空数组", () => {
    expect(topSuggestions("zzz", [{ role: "button", name: "提交" }])).toEqual([]);
  });

  it("去空白归一化支持: 导 出 能被 导出 计分匹配", () => {
    // 针对 antd 按钮中间空格 (Two-word button)
    const out = topSuggestions("导出", [
      { role: "button", name: "导 出" },
      { role: "button", name: "确 定" },
      { role: "button", name: "取 消" },
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].name).toBe("导 出");
  });
});
