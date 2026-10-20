// 面板双向化后端纯逻辑测试:预告高亮的空值安全。
// 页内注入函数依赖浏览器,不在单测范围。
import { describe, it, expect } from "vitest";
import { previewHighlight } from "../src/browser/tools.js";
import type { Page } from "playwright-core";

function fakePage(): Page {
  return {} as any;
}

describe("previewHighlight", () => {
  it("page 为 null / selector 为空时安全 no-op(不抛错)", () => {
    expect(() => previewHighlight(null, "#a", "click")).not.toThrow();
    expect(() => previewHighlight(fakePage(), "", "click")).not.toThrow();
  });

  it("evaluate 拒绝时静默(fire-and-forget 不抛出)", () => {
    const page = {
      evaluate: async () => {
        throw new Error("closed");
      },
    } as any;
    expect(() => previewHighlight(page, "#a", "click")).not.toThrow();
  });
});
