// F4 extract 字段建议(action:"suggest")纯逻辑测试:
// fieldsFromCells / fieldsFromCard / sampleOfFields / suggestWrap 与
// 建议产物可直接进入抽取链路(rowsOfExtract 同构)。
import { describe, it, expect } from "vitest";
import {
  fieldsFromCells, fieldsFromCard, sampleOfFields, suggestWrap, suggestFieldName, rowsOfExtract,
  type ExtractField,
} from "../src/browser/tools.js";
import type { SuggestAnalysis } from "../src/browser/tools.js";

describe("suggestFieldName(字段名净化)", () => {
  it("空白→下划线;空表头回落 col_N;限长 30", () => {
    expect(suggestFieldName("商品 名称", 0)).toBe("商品_名称");
    expect(suggestFieldName("   ", 2)).toBe("col_3");
    expect(suggestFieldName(undefined, 0)).toBe("col_1");
    expect(suggestFieldName("x".repeat(40), 0).length).toBe(30);
  });
});

describe("fieldsFromCells(表格单元格推断)", () => {
  it("文本/链接/图片分别成字段,selector 按 td 序号", () => {
    const cells = [
      { text: "iPhone 15" },
      { text: "查看", href: "/item/1" },
      { text: "缩略图", src: "/img/1.png" },
    ];
    expect(fieldsFromCells(["商品", "链接", "图片"], cells)).toEqual([
      { name: "商品", selector: "td:nth-of-type(1)" },
      { name: "链接_href", selector: "td:nth-of-type(2) a", attr: "href" },
      { name: "链接", selector: "td:nth-of-type(2)" },
      { name: "图片_src", selector: "td:nth-of-type(3) img", attr: "src" },
      { name: "图片", selector: "td:nth-of-type(3)" },
    ]);
  });

  it("无表头时字段名回落 col_N", () => {
    const f = fieldsFromCells([], [{ text: "a" }, { text: "b" }]);
    expect(f.map((x) => x.name)).toEqual(["col_1", "col_2"]);
  });
});

describe("fieldsFromCard(列表卡片推断)", () => {
  it("链接/图片/文本(首子元素)成字段", () => {
    expect(fieldsFromCard({ text: "卡片", href: "/x", src: "/s.png" })).toEqual([
      { name: "image", selector: "img", attr: "src" },
      { name: "link", selector: "a", attr: "href" },
      { name: "text", selector: ":scope > *:nth-child(1)" },
    ]);
  });
  it("无链接无图片时仍有 text 字段", () => {
    expect(fieldsFromCard({ text: "纯文本" })).toEqual([
      { name: "text", selector: ":scope > *:nth-child(1)" },
    ]);
  });
});

describe("sampleOfFields(首行样本)", () => {
  it("按 td 序号对位取值:文本/href/src;缺失为 null", () => {
    const cells = [
      { text: "行1 A" },
      { text: "详情", href: "/d/1" },
      { text: "图", src: "/i/1.png" },
    ];
    const fields = fieldsFromCells(["名称", "详情", "缩略图"], cells);
    expect(sampleOfFields(fields, cells)).toEqual({
      名称: "行1 A",
      详情_href: "/d/1",
      详情: "详情",
      缩略图_src: "/i/1.png",
      缩略图: "图",
    });
    expect(sampleOfFields([{ name: "l", selector: "a", attr: "href" }], [{ text: "x", href: "/h" }])).toEqual({ l: "/h" });
    expect(sampleOfFields([{ name: "l", selector: "a", attr: "href" }], [{ text: "x" }])).toEqual({ l: null });
    expect(sampleOfFields([{ name: "m", selector: "img", attr: "src" }], [{ text: "x" }])).toEqual({ m: null });
  });
});

describe("suggestWrap(汇总,验收场景)", () => {
  it("表格分析 → suggested:true,产物为单个 multiple rows 嵌套 fields + 样本", () => {
    const analysis: SuggestAnalysis = {
      ok: true,
      kind: "table",
      rowSelector: "table tr",
      headerTexts: ["名称", "价格", "链接"],
      cells: [{ text: "苹果" }, { text: "¥5" }, { text: "买", href: "/buy/1" }],
    };
    const r = suggestWrap(analysis);
    expect(r.suggested).toBe(true);
    expect(r.kind).toBe("table");
    expect(r.fields).toEqual([
      {
        name: "rows",
        selector: "table tr",
        multiple: true,
        fields: [
          { name: "名称", selector: "td:nth-of-type(1)" },
          { name: "价格", selector: "td:nth-of-type(2)" },
          { name: "链接_href", selector: "td:nth-of-type(3) a", attr: "href" },
          { name: "链接", selector: "td:nth-of-type(3)" },
        ],
      },
    ]);
    expect(r.sample).toMatchObject({ 名称: "苹果", 链接_href: "/buy/1" });
  });

  it("列表分析 → suggested:true(卡片模式)", () => {
    const r = suggestWrap({
      ok: true,
      kind: "list",
      rowSelector: "#list > li",
      item: { text: "卡片标题", href: "/c/1" },
    });
    expect(r.suggested).toBe(true);
    expect(r.fields![0]).toMatchObject({ name: "rows", selector: "#list > li", multiple: true });
    expect(r.sample).toMatchObject({ link: "/c/1", text: "卡片标题" });
  });

  it("推断失败 → suggested:false + 原因与容器概览透传(不猜)", () => {
    const r = suggestWrap({
      ok: false,
      reason: "未发现规律结构",
      overview: { links: 12, images: 3, buttons: 2, headings: 1, rows: 0, textChars: 800 },
    });
    expect(r.suggested).toBe(false);
    expect(r.fields).toBeUndefined();
    expect(r.overview).toEqual({ links: 12, images: 3, buttons: 2, headings: 1, rows: 0, textChars: 800 });
  });

  it("建议 fields 可直接进入抽取链路:rowsOfExtract 按单 multiple 字段取行(一次 suggest + 一次 extract 闭环)", () => {
    const analysis: SuggestAnalysis = {
      ok: true,
      kind: "table",
      rowSelector: "table tr",
      headerTexts: ["名称"],
      cells: [{ text: "苹果" }],
    };
    const fields = suggestWrap(analysis).fields as ExtractField[];
    // 模拟用建议 fields 跑 extractFieldsInPage 的输出形状
    const extractResult = { rows: [{ 名称: "苹果" }, { 名称: "香蕉" }] };
    expect(rowsOfExtract(extractResult, fields)).toEqual([
      { 名称: "苹果" },
      { 名称: "香蕉" },
    ]);
  });
});
