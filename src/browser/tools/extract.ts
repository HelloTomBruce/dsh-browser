// dsh-browser · 浏览器工具 — 结构化数据抽取与字段推断
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import { getPage, pageIdentity } from "../session.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { injectWalker } from "../walker.js";
import { formatFromFile, serializeRows } from "../extract.js";
import { workspaceFilePath } from "./common.js";
import { adapterRegistry } from "../adapters/index.js";

export interface ExtractField {
  name: string;
  selector: string;
  attr?: string;
  multiple?: boolean;
  fields?: ExtractField[];
}

/**
 * 页内抽取(自包含函数,page.evaluate 序列化注入):
 * attr 缺省取可见文本(innerText/textContent),否则 getAttribute(attr);
 * multiple 收集所有命中;fields 嵌套时在每个命中元素内递归抽取。
 */
function extractFieldsInPage(fields: ExtractField[]): Record<string, any> {
  const __name = (t: any, v: any) => t;
  const val = (el: Element | null, attr?: string): string | null => {
    if (el === null) return null;
    if (attr !== undefined && attr !== "" && attr !== "text" && attr !== "textContent") {
      return el.getAttribute(attr);
    }
    return ((el as HTMLElement).innerText || el.textContent || "").trim();
  };
  const run = (scope: Element | Document, spec: ExtractField[]): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const f of spec) {
      const els = Array.from(scope.querySelectorAll(f.selector));
      if (f.multiple === true) {
        if (Array.isArray(f.fields) && f.fields.length > 0) {
          out[f.name] = els.map((el) => run(el, f.fields!));
        } else {
          out[f.name] = els.map((el) => val(el, f.attr));
        }
      } else {
        const el = els[0] ?? null;
        if (el !== null && Array.isArray(f.fields) && f.fields.length > 0) {
          out[f.name] = run(el, f.fields);
        } else {
          out[f.name] = val(el, f.attr);
        }
      }
    }
    return out;
  };
  return run(document, fields);
}

/**
 * 把单页抽取结果规整为行数组:恰好一个顶层 multiple 字段时,其数组即行
 * (行内嵌套对象为行,标量包装成 { [name]: value });否则整页算一行。
 */
export function rowsOfExtract(result: Record<string, any>, fields: ExtractField[]): Record<string, any>[] {
  const multi = fields.filter((f) => f.multiple === true);
  if (multi.length === 1) {
    const name = multi[0].name;
    const arr = Array.isArray(result[name]) ? result[name] : [];
    return arr.map((item: any) =>
      item !== null && typeof item === "object" ? (item as Record<string, any>) : { [name]: item },
    );
  }
  return [result];
}

/** suggest 采集的表格单元格信息(页内采集,纯函数消费)。 */
export interface SuggestCell {
  text: string;
  href?: string;
  src?: string;
}

/** suggest 页内分析结果(自包含 injectWalker 注入采集)。 */
export interface SuggestAnalysis {
  ok: boolean;
  /** table: 表格行模式;list: 重复卡片/列表项模式。 */
  kind?: "table" | "list";
  /** 行/卡片选择器(抽取 fields 顶层的 multiple selector)。 */
  rowSelector?: string;
  headerTexts?: string[];
  cells?: SuggestCell[];
  item?: SuggestCell;
  reason?: string;
  overview?: { links: number; images: number; buttons: number; headings: number; rows: number; textChars: number };
}

/** suggest 的页内结构探测(injectWalker 注入;walker 提供 cssPath)。 */
const suggestFieldsInPage = injectWalker<{ scope: string }, SuggestAnalysis>((payload, w) => {
  const root = payload.scope !== "" ? document.querySelector(payload.scope) : document.body;
  if (root === null) return { ok: false, reason: `scope 未命中: 页面中没有匹配 "${payload.scope}" 的元素` };
  const cellOf = (el: Element): SuggestCell => {
    const a = el.querySelector("a[href]");
    const img = el.querySelector("img[src]");
    return {
      text: ((el as HTMLElement).innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      ...(a !== null ? { href: a.getAttribute("href") ?? "" } : {}),
      ...(img !== null ? { src: img.getAttribute("src") ?? "" } : {}),
    };
  };
  // 1) 表格模式:≥2 行,且首行(或第二行)是数据行 → td 单元格结构
  const rows = Array.from(root.querySelectorAll("table tr"));
  if (rows.length >= 2) {
    const first = rows[0]!;
    let headerTexts: string[] = [];
    let record: Element | null = null;
    if (first.querySelector("th") !== null) {
      headerTexts = Array.from(first.querySelectorAll("th, td")).map((c) =>
        ((c as HTMLElement).innerText || c.textContent || "").trim(),
      );
      record = rows[1] ?? null;
    } else {
      record = first;
    }
    if (record !== null) {
      const cells = Array.from(record.querySelectorAll("td, th")).map(cellOf);
      if (cells.length > 0) {
        return { ok: true, kind: "table", rowSelector: "table tr", headerTexts, cells };
      }
    }
  }
  // 2) 列表/卡片模式:ul/ol 下 ≥2 个直接 li,或同父 ≥3 个同名兄弟卡片容器
  const list = root.querySelector("ul, ol");
  if (list !== null) {
    const lis = Array.from(list.children).filter((c) => c.tagName === "LI");
    if (lis.length >= 2) {
      const li = lis[0]!;
      return {
        ok: true,
        kind: "list",
        rowSelector: `${w.cssPath(list)} > li`,
        item: cellOf(li),
      };
    }
  }
  // 3) 推断失败:不猜,给容器概览帮助 agent 手写 fields
  return {
    ok: false,
    reason: "未发现规律结构(无 ≥2 行的表格,也无 ≥2 项的列表);请用 browser_elements/browser_snapshot 查看结构后手写 fields",
    overview: {
      links: root.querySelectorAll("a").length,
      images: root.querySelectorAll("img").length,
      buttons: root.querySelectorAll("button, [role='button']").length,
      headings: root.querySelectorAll("h1, h2, h3, h4").length,
      rows: rows.length,
      textChars: ((root as HTMLElement).innerText || "").length,
    },
  };
});

/** 字段名净化:空白→下划线,限长 30,空回落 col_N。导出供测试。 */
export function suggestFieldName(header: string | undefined, index: number): string {
  const h = (header ?? "").trim().replace(/\s+/g, "_");
  return h !== "" ? h.slice(0, 30) : `col_${index + 1}`;
}

/**
 * 纯逻辑:由表头与首行单元格特征推断表格 fields(单元格文本/链接 href/图片 src)。
 * 返回可直接放进 rows.fields 的嵌套字段数组。导出供测试。
 */
export function fieldsFromCells(headerTexts: string[], cells: SuggestCell[]): ExtractField[] {
  const out: ExtractField[] = [];
  cells.forEach((c, i) => {
    const name = suggestFieldName(headerTexts[i], i);
    const sel = `td:nth-of-type(${i + 1})`;
    if (c.src !== undefined) out.push({ name: `${name}_src`, selector: `${sel} img`, attr: "src" });
    if (c.href !== undefined) out.push({ name: `${name}_href`, selector: `${sel} a`, attr: "href" });
    out.push({ name, selector: sel });
  });
  return out;
}

/**
 * 纯逻辑:由首条卡片信息推断列表 fields(项文本/链接/图片)。
 * 文本取第一个子元素(项自身无法用 querySelector 自选)。导出供测试。
 */
export function fieldsFromCard(item: SuggestCell): ExtractField[] {
  const out: ExtractField[] = [];
  if (item.src !== undefined) out.push({ name: "image", selector: "img", attr: "src" });
  if (item.href !== undefined) out.push({ name: "link", selector: "a", attr: "href" });
  out.push({ name: "text", selector: ":scope > *:nth-child(1)" });
  return out;
}

/** 纯逻辑:由 fields 与单元格样本拼出首行样例(与抽取输出同构;按 td 序号对位)。导出供测试。 */
export function sampleOfFields(fields: ExtractField[], cells: SuggestCell[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const m = /td:nth-of-type\((\d+)\)/.exec(f.selector);
    const idx = m !== null ? Number(m[1]) - 1 : 0;
    const c = cells[idx];
    if (f.attr === "href") out[f.name] = c?.href ?? null;
    else if (f.attr === "src") out[f.name] = c?.src ?? null;
    else out[f.name] = c?.text ?? null;
  }
  return out;
}

/**
 * suggest 汇总(纯逻辑):由页内分析结果组装「可直接交给抽取模式」的顶层 fields
 * (单个 multiple rows 字段 + 行内嵌套字段)与样本。推断失败原样返回。导出供测试。
 */
export function suggestWrap(analysis: SuggestAnalysis): {
  suggested: boolean;
  kind?: "table" | "list";
  rowSelector?: string;
  headerTexts?: string[];
  fields?: ExtractField[];
  sample?: Record<string, unknown>;
  reason?: string;
  overview?: SuggestAnalysis["overview"];
} {
  if (!analysis.ok || analysis.kind === undefined || analysis.rowSelector === undefined) {
    return { suggested: false, reason: analysis.reason ?? "结构不足以推断字段", ...(analysis.overview !== undefined ? { overview: analysis.overview } : {}) };
  }
  const rowFields =
    analysis.kind === "table"
      ? fieldsFromCells(analysis.headerTexts ?? [], analysis.cells ?? [])
      : fieldsFromCard(analysis.item ?? { text: "" });
  if (rowFields.length === 0) {
    return { suggested: false, reason: "首条记录内未发现可抽取内容(文本/链接/图片)", ...(analysis.overview !== undefined ? { overview: analysis.overview } : {}) };
  }
  const sample = sampleOfFields(
    rowFields,
    analysis.kind === "table" ? (analysis.cells ?? []) : [analysis.item ?? { text: "" }],
  );
  return {
    suggested: true,
    kind: analysis.kind,
    rowSelector: analysis.rowSelector,
    ...(analysis.headerTexts !== undefined ? { headerTexts: analysis.headerTexts } : {}),
    fields: [{ name: "rows", selector: analysis.rowSelector, multiple: true, fields: rowFields }],
    sample,
  };
}

export async function extractTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  // F4 字段建议模式:不抽取,只返回建议 fields + 样本(agent 微调后交给抽取模式)。
  if (args.action === "suggest") {
    const scope = typeof args.scope === "string" && args.scope !== "" ? args.scope : "";
    const analysis = await page.evaluate(suggestFieldsInPage, { scope });
    return {
      action: "suggest",
      ...suggestWrap(analysis),
      ...(await pageIdentity(page)),
    };
  }
  const fields = args.fields as ExtractField[];
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("extract 需要 fields:[{ name, selector, attr?, multiple?, fields? }] 或 action: \"suggest\" 推断字段");
  }
  for (const f of fields) {
    if (typeof f?.name !== "string" || f.name === "" || typeof f?.selector !== "string" || f.selector === "") {
      throw new Error("fields 每项需要非空 name 与 selector");
    }
  }
  const maxPages = Math.min(Math.max(Number(args.maxPages ?? 1) || 1, 1), 100);
  const maxRows = Math.min(Math.max(Number(args.maxRows ?? config.maxRows ?? 1000) || 1000, 1), 100_000);
  const waitAfterMs = Math.min(Math.max(Number(args.waitAfterMs ?? 800) || 0, 0), 10_000);

  const rows: Record<string, any>[] = [];
  let pages = 0;

  if (args.scrollMode === "virtual") {
    // F5 虚拟滚动逐屏抽取
    const fieldMap: Record<string, string> = {};
    for (const f of fields) {
      if (Array.isArray(f.fields) && f.fields.length > 0) {
        for (const sub of f.fields) {
          fieldMap[sub.name] = sub.selector;
        }
      } else {
        fieldMap[f.name] = f.selector;
      }
    }
    const virtualRows = await adapterRegistry.extractVirtualList(page, {
      scope: typeof args.scope === "string" ? args.scope : undefined,
      fields: fieldMap,
      maxRows,
      stepPixels: typeof args.stepPixels === "number" ? args.stepPixels : 350,
    });
    rows.push(...virtualRows);
    pages = 1;
  } else {
    for (;;) {
      const result = await page.evaluate(extractFieldsInPage, fields);
      rows.push(...rowsOfExtract(result, fields));
      pages++;
      if (rows.length >= maxRows) break;
      const nextSel = typeof args.next === "string" && args.next !== "" ? args.next : null;
      if (nextSel === null || pages >= maxPages) break;
      const next = page.locator(nextSel).first();
      if ((await next.count().catch(() => 0)) === 0) break;
      const usable = await next
        .evaluate((el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const visible = style.visibility !== "hidden" && style.display !== "none" && (rect.width > 0 || rect.height > 0);
          const disabled =
            (el as HTMLButtonElement).disabled === true ||
            el.getAttribute("aria-disabled") === "true" ||
            el.classList.contains("disabled") ||
            el.classList.contains("ant-pagination-disabled");
          return visible && !disabled;
        })
        .catch(() => false);
      if (!usable) break;
      await next.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      if (waitAfterMs > 0) await page.waitForTimeout(waitAfterMs);
    }
  }

  const truncated = rows.length > maxRows;
  const finalRows = truncated ? rows.slice(0, maxRows) : rows;
  const format =
    typeof args.format === "string" && args.format !== ""
      ? args.format
      : (typeof args.file === "string" ? formatFromFile(args.file) : null) ?? "json";
  if (!["json", "csv", "jsonl", "markdown"].includes(format)) {
    throw new Error(`未知 format: ${format}(支持 json / csv / jsonl / markdown)`);
  }

  let file: string | undefined;
  let bytes: number | undefined;
  if (typeof args.file === "string" && args.file !== "") {
    const cwd = workspaceBaseDir(config, exec);
    file = workspaceFilePath(cwd, args.file);
    const content = serializeRows(finalRows, format);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
    bytes = Buffer.byteLength(content, "utf8");
  }

  return {
    rows: finalRows,
    count: finalRows.length,
    pages,
    format,
    ...(truncated ? { truncated: true } : { truncated: false }),
    ...(file !== undefined ? { file, bytes } : {}),
    ...(await pageIdentity(page)),
  };
}
