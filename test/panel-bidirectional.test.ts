// 面板双向化后端纯逻辑测试:拾取结果读取(takePickResult)与预告高亮的
// 空值安全。页内注入函数依赖浏览器,不在单测范围。
import { describe, it, expect } from "vitest";
import { takePickResult, previewHighlight } from "../src/browser/tools.js";
import type { Page } from "playwright-core";

function fakePage(evals: unknown[]): Page {
  let i = 0;
  return {
    evaluate: async () => evals[i++] ?? null,
  } as any;
}

describe("takePickResult", () => {
  it("读取一次后返回 null(取后自清语义由页内清空实现)", async () => {
    const page = fakePage([{ selector: "#submit", tag: "button" }, null]);
    expect(await takePickResult(page)).toMatchObject({ selector: "#submit", tag: "button" });
    expect(await takePickResult(page)).toBeNull();
  });

  it("evaluate 抛错(页面导航/关闭)返回 null 不抛出", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("nav");
      },
    } as any;
    expect(await takePickResult(page)).toBeNull();
  });
});

describe("previewHighlight", () => {
  it("page 为 null / selector 为空时安全 no-op(不抛错)", () => {
    expect(() => previewHighlight(null, "#a", "click")).not.toThrow();
    expect(() => previewHighlight({} as any, "", "click")).not.toThrow();
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
