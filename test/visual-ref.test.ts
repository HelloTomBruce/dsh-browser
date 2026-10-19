// F3/F1:PNG 头解析、mask 缩放、ref 注册表与 targetLocator 解析语义
import { describe, it, expect } from "vitest";
import { pngSize, scaleRects, targetLocator } from "../src/browser/tools.js";
import { setPageRefs, pageRef, clearPageRefs } from "../src/browser/session.js";
import type { Page } from "playwright-core";

/** 伪造一个 24 字节 PNG 头(IHDR 宽高可指定)。 */
function fakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR 数据长度
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

describe("pngSize(PNG 头解析)", () => {
  it("读取 IHDR 宽高", () => {
    expect(pngSize(fakePng(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(pngSize(fakePng(1, 1))).toEqual({ width: 1, height: 1 });
  });
  it("非 PNG 报错", () => {
    expect(() => pngSize(Buffer.alloc(24))).toThrow(/not a PNG/);
  });
});

describe("scaleRects(mask 坐标缩放)", () => {
  it("按比例换算并取整", () => {
    expect(scaleRects([{ x: 10, y: 20, width: 100, height: 50 }], 0.5)).toEqual([
      { x: 5, y: 10, width: 50, height: 25 },
    ]);
    expect(scaleRects([{ x: 3, y: 3, width: 7, height: 7 }], 1)).toEqual([
      { x: 3, y: 3, width: 7, height: 7 },
    ]);
  });
  it("空 mask 透传", () => {
    expect(scaleRects([], 0.25)).toEqual([]);
  });
});

describe("ref 注册表(session)", () => {
  it("set → get → clear 语义(WeakMap 按 page 实例隔离)", () => {
    const pageA = {} as Page;
    const pageB = {} as Page;
    setPageRefs(pageA, new Map([["e1", { role: "button", name: "登录", selector: "#login" }]]));
    expect(pageRef(pageA, "e1")).toEqual({ role: "button", name: "登录", selector: "#login" });
    expect(pageRef(pageB, "e1")).toBeUndefined(); // 其他页面不可见
    clearPageRefs(pageA);
    expect(pageRef(pageA, "e1")).toBeUndefined();
  });
  it("整表替换后旧 ref 失效", () => {
    const page = {} as Page;
    setPageRefs(page, new Map([["e1", { role: "link", name: "a", selector: "#a" }]]));
    setPageRefs(page, new Map([["e2", { role: "link", name: "b", selector: "#b" }]]));
    expect(pageRef(page, "e1")).toBeUndefined();
    expect(pageRef(page, "e2")).toBeDefined();
  });
});

describe("targetLocator(ref 解析语义)", () => {
  const entry = { role: "button", name: "提交", selector: "#old" };

  it("未注册的 ref 报「未知 ref」", async () => {
    const page = {} as Page;
    await expect(targetLocator(page, { ref: "e9" })).rejects.toThrow(/未知 ref/);
  });

  it("CSS 路径失效且 role+name 也找不到时报「ref 已失效」", async () => {
    const page = {
      locator: () => ({ first: () => ({ count: async () => 0 }) }),
      getByRole: () => ({ first: () => ({ count: async () => 0 }) }),
    } as any;
    setPageRefs(page, new Map([["e1", entry]]));
    await expect(targetLocator(page, { ref: "e1" })).rejects.toThrow(/已失效/);
  });

  it("CSS 路径命中且 role/name 校验通过 → 直接使用", async () => {
    const page = {
      locator: () => ({
        first: () => ({
          count: async () => 1,
          evaluate: async () => true,
          marker: "by-path",
        }),
      }),
      getByRole: () => ({ first: () => ({ count: async () => 0 }) }),
    } as any;
    setPageRefs(page, new Map([["e1", entry]]));
    const loc: any = await targetLocator(page, { ref: "e1" });
    expect(loc.marker).toBe("by-path");
  });

  it("CSS 路径存在但 role/name 不匹配 → 降级 getByRole", async () => {
    const page = {
      locator: () => ({
        first: () => ({
          count: async () => 1,
          evaluate: async () => false, // role/name 漂移
        }),
      }),
      getByRole: () => ({ first: () => ({ count: async () => 2, marker: "by-role" }) }),
    } as any;
    setPageRefs(page, new Map([["e1", entry]]));
    const loc: any = await targetLocator(page, { ref: "e1" });
    expect(loc.marker).toBe("by-role");
  });

  it("selector 直译:无 ref 时走 selector", async () => {
    const page = {
      locator: (sel: string) => ({ first: () => ({ marker: sel }) }),
    } as any;
    const loc: any = await targetLocator(page, { selector: "#x" });
    expect(loc.marker).toBe("#x");
  });

  it("selector 与 ref 都缺时报错", async () => {
    const page = {} as Page;
    await expect(targetLocator(page, {})).rejects.toThrow(/selector 或 ref/);
  });
});
