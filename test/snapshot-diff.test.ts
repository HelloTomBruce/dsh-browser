// browser_snapshot 增量/区域快照的纯逻辑测试:diffLines(公共前缀/后缀掐尾)。
// 页内提取与缓存语义依赖浏览器,不在单测范围。
import { describe, it, expect } from "vitest";
import { diffLines } from "../src/browser/tools.js";

describe("diffLines", () => {
  it("全等返回 unchanged", () => {
    expect(diffLines("a\nb\nc", "a\nb\nc")).toEqual({ unchanged: true });
    expect(diffLines("", "")).toEqual({ unchanged: true });
  });

  it("尾部追加:公共前缀保留,changedFrom 指变化起首行", () => {
    const d = diffLines("a\nb\nc", "a\nb\nc\nd\ne");
    expect(d.unchanged).toBe(false);
    expect(d.changedFrom).toBe(4);
    expect(d.lines).toEqual(["d", "e"]);
    expect(d.removed).toBe(0);
  });

  it("头部插入:公共后缀保留,changedFrom=1", () => {
    const d = diffLines("c\nd", "a\nb\nc\nd");
    expect(d.changedFrom).toBe(1);
    expect(d.lines).toEqual(["a", "b"]);
    expect(d.removed).toBe(0);
  });

  it("中部修改:前后公共行都掐掉", () => {
    const d = diffLines("a\nb\nc\nd\ne", "a\nb\nX\nd\ne");
    expect(d.changedFrom).toBe(3);
    expect(d.lines).toEqual(["X"]);
    expect(d.removed).toBe(1);
  });

  it("整页替换:changedFrom=1,removed=旧行数", () => {
    const d = diffLines("a\nb\nc", "x\ny");
    expect(d.changedFrom).toBe(1);
    expect(d.lines).toEqual(["x", "y"]);
    expect(d.removed).toBe(3);
  });

  it("旧文本空 → changedFrom=1,removed=0", () => {
    const d = diffLines("", "a\nb");
    expect(d.changedFrom).toBe(1);
    expect(d.lines).toEqual(["a", "b"]);
    expect(d.removed).toBe(0);
  });

  it("表格翻页场景:只有数据行变化,页头页脚噪声被掐掉", () => {
    const oldPage = ["标题", "表头1 表头2", "行1 A", "行2 B", "共 2 条"].join("\n");
    const newPage = ["标题", "表头1 表头2", "行1 A", "行2 B", "行3 C", "共 3 条"].join("\n");
    const d = diffLines(oldPage, newPage);
    expect(d.changedFrom).toBe(5);
    expect(d.lines).toEqual(["行3 C", "共 3 条"]);
  });
});
