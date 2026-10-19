// F7 browser_extract:序列化与 CSV 解析的纯函数测试
import { describe, it, expect } from "vitest";
import {
  toCsv, toJsonl, toMarkdownTable, serializeRows, formatFromFile, parseCsv,
} from "../src/browser/extract.js";
import { rowsOfExtract, workspaceFilePath } from "../src/browser/tools.js";

describe("CSV 序列化", () => {
  it("基本行与表头(并集)", () => {
    const csv = toCsv([
      { name: "a", price: 1 },
      { name: "b", extra: "x" },
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe("name,price,extra");
    expect(lines[1]).toBe("a,1,");
    expect(lines[2]).toBe("b,,x");
  });

  it("逗号/引号/换行正确转义", () => {
    const csv = toCsv([{ v: '含,逗号', w: '含"引号', x: "含\n换行" }]);
    expect(csv).toBe('v,w,x\n"含,逗号","含""引号","含\n换行"\n');
  });

  it("非字符串值 JSON 化", () => {
    const csv = toCsv([{ v: { a: 1 } }]);
    expect(csv.trimEnd().split("\n")[1]).toBe('"{""a"":1}"');
  });
});

describe("其他序列化格式", () => {
  it("jsonl 每行一个 JSON", () => {
    const out = toJsonl([{ a: 1 }, { a: 2 }]);
    expect(out.split("\n")[0]).toBe('{"a":1}');
    expect(out.split("\n")[1]).toBe('{"a":2}');
  });

  it("markdown 表格转义竖线", () => {
    const out = toMarkdownTable([{ a: "x|y" }]);
    expect(out).toContain("x\\|y");
    expect(out).toContain("| --- |");
  });

  it("serializeRows 分发", () => {
    expect(serializeRows([{ a: 1 }], "jsonl")).toContain('{"a":1}');
    expect(JSON.parse(serializeRows([{ a: 1 }], "json"))).toEqual([{ a: 1 }]);
  });

  it("formatFromFile 按扩展名推断", () => {
    expect(formatFromFile("out/a.csv")).toBe("csv");
    expect(formatFromFile("out/a.JSONL")).toBe("jsonl");
    expect(formatFromFile("out/a.md")).toBe("markdown");
    expect(formatFromFile("out/a.json")).toBe("json");
    expect(formatFromFile("out/a.txt")).toBe(null);
  });
});

describe("parseCsv", () => {
  it("基本解析(首行为表头)", () => {
    const rows = parseCsv("user,pass\na,1\nb,2\n");
    expect(rows).toEqual([
      { user: "a", pass: "1" },
      { user: "b", pass: "2" },
    ]);
  });

  it("引号内逗号与双引号转义", () => {
    const rows = parseCsv('v\n"a,b"\n"he said ""hi"""\n');
    expect(rows[0].v).toBe("a,b");
    expect(rows[1].v).toBe('he said "hi"');
  });

  it("引号内换行保留", () => {
    const rows = parseCsv('v\n"a\nb"\n');
    expect(rows[0].v).toBe("a\nb");
  });

  it("跳过空行,CRLF 兼容", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("缺列补空串", () => {
    const rows = parseCsv("a,b\n1\n");
    expect(rows[0]).toEqual({ a: "1", b: "" });
  });
});

describe("rowsOfExtract(单页结果 → 行数组)", () => {
  it("恰好一个 multiple 字段时其数组即行(对象)", () => {
    const fields = [{ name: "rows", selector: "tr", multiple: true, fields: [{ name: "t", selector: "td" }] }];
    const result = { rows: [{ t: "a" }, { t: "b" }], other: 1 };
    expect(rowsOfExtract(result, fields)).toEqual([{ t: "a" }, { t: "b" }]);
  });

  it("标量数组包装为对象行", () => {
    const fields = [{ name: "links", selector: "a", multiple: true }];
    expect(rowsOfExtract({ links: ["a", "b"] }, fields)).toEqual([{ links: "a" }, { links: "b" }]);
  });

  it("无 multiple 字段时整页一行", () => {
    const fields = [{ name: "title", selector: "h1" }];
    expect(rowsOfExtract({ title: "hi" }, fields)).toEqual([{ title: "hi" }]);
  });
});

describe("workspaceFilePath(路径穿越拒绝)", () => {
  const cwd = "/tmp/ws";
  it("工作区内路径放行", () => {
    expect(workspaceFilePath(cwd, "out/a.csv")).toBe("/tmp/ws/out/a.csv");
    expect(workspaceFilePath(cwd, "a.csv")).toBe("/tmp/ws/a.csv");
  });
  it(".. 穿越被拒绝", () => {
    expect(() => workspaceFilePath(cwd, "../escape.csv")).toThrow(/越出工作区/);
    expect(() => workspaceFilePath(cwd, "out/../../escape.csv")).toThrow(/越出工作区/);
  });
});
