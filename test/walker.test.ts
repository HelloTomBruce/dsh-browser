// F5 walker 单一来源:注入函数的自包含性与拼装正确性(不依赖真实浏览器)。
import { describe, it, expect } from "vitest";
import { injectWalker } from "../src/browser/walker.js";

describe("injectWalker(F5 构建期拼装)", () => {
  it("生成的函数可序列化且自包含(含 walker 核心源码)", () => {
    const fn = injectWalker<unknown, boolean>((_p, w) => w.INTERACTIVE.has("button"));
    const src = fn.toString();
    // evaluate 序列化注入要求:函数源码里带着完整 walker 核心,无外部闭包引用
    expect(src).toContain("function cssPath");
    expect(src).toContain("function roleOf");
    expect(src).toContain("function nameOf");
    expect(src).toContain("function isVisible");
    expect(src).toContain("function describeElement");
  });

  it("entry 通过 w 拿到 walker API 并正确执行", () => {
    const fn = injectWalker<unknown, { interactive: boolean; structural: boolean }>((_p, w) => ({
      interactive: w.INTERACTIVE.has("textbox") && !w.INTERACTIVE.has("list"),
      structural: w.STRUCTURAL.has("heading") && !w.STRUCTURAL.has("listitem"),
    }));
    expect(fn(null)).toEqual({ interactive: true, structural: true });
  });

  it("payload 正确透传给 entry", () => {
    const fn = injectWalker<number, number>((p, _w) => p * 2);
    expect(fn(21)).toBe(42);
  });
});
