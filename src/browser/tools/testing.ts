// dsh-browser · 浏览器工具 — 断言、等待与网络监控
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import type { Page } from "playwright-core";
import type { ToolRunContext } from "../../lib/types.js";
import type { BrowserConfig } from "../types.js";
import {
  getPage, activePage, networkEntries, clearNetwork, currentProfile,
  pageIdentity, noteScreenshotDir, cleanupScreenshots,
} from "../session.js";
import { workspaceBaseDir } from "../../lib/tools.js";
import { safeName as sanitizeName } from "../recordings.js";
import { targetLocator } from "./interaction.js";
import { lcsScore, pngSize, scaleRects } from "./common.js";

export async function waitTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const ms = Math.max(0, Math.min(Number(args.ms ?? 1000) || 0, 60000));
  await page.waitForTimeout(ms);
  return { waitedMs: ms, ...(await pageIdentity(page)) };
}

/**
 * 条件检查引擎(测试原语共用)。
 *
 * cond 支持六类(每类内部互斥,取第一个存在的字段):
 *   { selector: "#btn", state: "visible|hidden|attached|detached" }  元素状态(默认 visible)
 *   { url: "正则字符串" }                                            当前 URL 匹配
 *   { text: "子串" }                                                  body 可见文本包含
 *   { count: { selector, op: "eq|gt|gte|lt|lte", value: n } }         元素数量比较
 *   { eval: "JS 表达式" }                                            表达式求值 truthy
 *   { bridge: { method, args?, expect?/expectContains? } }           页内调用 __DSH_BRIDGE__ 方法并断言返回
 */
export type TestCondition = Record<string, any>;

/** 单次检查:返回 { ok, detail }。不抛错,失败时 detail 给出原因。 */
export async function checkOnce(page: Page, cond: TestCondition): Promise<{ ok: boolean; detail?: string }> {
  if (
    cond.ref !== undefined ||
    cond.selector !== undefined ||
    cond.row !== undefined ||
    cond.rowText !== undefined
  ) {
    const state = String(cond.state ?? "visible");
    try {
      const target = await targetLocator(page, cond);
      await target.waitFor({ state: state as any, timeout: 120 });
      return { ok: true };
    } catch {
      const desc =
        cond.ref !== undefined
          ? `ref ${String(cond.ref)}`
          : cond.row !== undefined || cond.rowText !== undefined
            ? `row "${String(cond.row ?? cond.rowText)}"`
            : `元素 ${cond.selector}`;
      return { ok: false, detail: `${desc} 未达到 ${state}` };
    }
  }
  if (cond.url !== undefined) {
    const url = page.url();
    try {
      return new RegExp(String(cond.url)).test(url) ? { ok: true } : { ok: false, detail: `URL 不匹配 ${cond.url}(当前 ${url})` };
    } catch {
      return { ok: false, detail: `非法正则: ${cond.url}` };
    }
  }
  if (cond.text !== undefined) {
    const needle = String(cond.text);
    try {
      const has = await page.evaluate((s) => {
        const bodyText = document.body ? document.body.innerText || "" : "";
        if (bodyText.includes(s)) return true;
        const clean = (str: string) => str.replace(/[\s\u00a0]+/g, "").toLowerCase();
        return clean(bodyText).includes(clean(s));
      }, needle);
      return has ? { ok: true } : { ok: false, detail: `页面文本不含 "${needle}"` };
    } catch (e) {
      return { ok: false, detail: `文本检查失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (cond.count !== undefined && typeof cond.count === "object") {
    const c = cond.count as { selector: string; op?: string; value: number };
    try {
      let sel = String(c.selector);
      if (/:visible\b/.test(sel)) {
        sel = sel.replace(/:visible\b/g, " >> visible=true");
      }
      const actual = await page.locator(sel).count();
      const want = Number(c.value);
      const op = c.op ?? "eq";
      const ok =
        op === "eq" ? actual === want
        : op === "gt" ? actual > want
        : op === "gte" ? actual >= want
        : op === "lt" ? actual < want
        : op === "lte" ? actual <= want
        : false;
      return ok ? { ok: true } : { ok: false, detail: `${c.selector} 数量 ${actual} 不满足 ${op} ${want}` };
    } catch (e) {
      return { ok: false, detail: `数量检查失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (cond.eval !== undefined) {
    try {
      const script = String(cond.eval).trim();
      // 语法归一化: 消除 eval 语法差异，统一支持纯表达式与带 return / 语句块的形式
      const wrapped = /[\n;]|^\s*return\b/.test(script)
        ? `(async () => {\n${script}\n})()`
        : `(${script})`;
      const value = await page.evaluate(wrapped);
      return value ? { ok: true } : { ok: false, detail: `eval 条件为假: ${cond.eval}` };
    } catch (e) {
      return { ok: false, detail: `eval 执行失败: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  if (cond.bridge !== undefined && typeof cond.bridge === "object") {
    // bridge 条件:调用页面 __DSH_BRIDGE__(vite-plugin-dsh-bridge)方法并断言返回,
    // 把"桥取数"接入宿主的结构化断言/等待(失败自动截图留证)。判定收窄为最小集:
    // 缺省 expect → truthy;expect → JSON 深比较;字符串结果另支持 expectContains。
    const spec = cond.bridge as { method?: string; args?: unknown[]; expect?: unknown; expectContains?: string };
    const method = String(spec.method ?? "");
    const trunc = (v: unknown) => {
      const s = JSON.stringify(v) ?? String(v);
      return s.length > 500 ? `${s.slice(0, 500)}…(截断)` : s;
    };
    if (method === "") return { ok: false, detail: "bridge 条件需要 method(__DSH_BRIDGE__ 方法名)" };
    try {
      const value = await page.evaluate(
        async (payload: { method: string; args: unknown[] }) => {
          const bridge = (window as any).__DSH_BRIDGE__;
          if (bridge === undefined || bridge === null) {
            throw new Error("NO_BRIDGE:页面无 __DSH_BRIDGE__(未接入 vite-plugin-dsh-bridge?)");
          }
          if (typeof bridge[payload.method] !== "function") {
            throw new Error(`NO_BRIDGE:__DSH_BRIDGE__ 无方法 ${payload.method}`);
          }
          return await bridge[payload.method](...payload.args);
        },
        { method, args: Array.isArray(spec.args) ? spec.args : [] },
      );
      const actual: unknown = JSON.parse(JSON.stringify(value ?? null));
      if (spec.expectContains !== undefined) {
        const hay = typeof actual === "string" ? actual : JSON.stringify(actual);
        return hay.includes(String(spec.expectContains))
          ? { ok: true }
          : { ok: false, detail: `[bridge] ${method}() 结果不含 "${spec.expectContains}"(实际: ${trunc(actual)})` };
      }
      if (spec.expect !== undefined) {
        return JSON.stringify(actual) === JSON.stringify(spec.expect)
          ? { ok: true }
          : { ok: false, detail: `[bridge] ${method}() = ${trunc(actual)} ≠ 期望 ${trunc(spec.expect)}` };
      }
      return actual ? { ok: true } : { ok: false, detail: `[bridge] ${method}() 返回假值: ${trunc(actual)}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("NO_BRIDGE:")) return { ok: false, detail: `[bridge] ${msg.slice("NO_BRIDGE:".length)}` };
      return { ok: false, detail: `[bridge] ${method}() 执行失败: ${msg}` };
    }
  }
  throw new Error("条件无效: 需要 selector/url/text/count/eval/bridge 之一");
}

/** 轮询等待条件成立(intervalMs 步进),返回最后一次检查结果。 */
export async function pollCondition(
  page: Page,
  cond: TestCondition,
  timeoutMs: number,
  intervalMs = 500,
): Promise<{ ok: boolean; detail?: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { ok: boolean; detail?: string } = { ok: false, detail: "超时" };
  while (Date.now() < deadline) {
    try {
      last = await checkOnce(page, cond);
      if (last.ok) return last;
    } catch (e) {
      last = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

/** 通用显式等待:等待条件成立,超时抛错。 */
export async function waitForTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 120_000);
  const intervalMs = Math.max(Number(args.intervalMs ?? 500) || 500, 100);
  const cond = args.condition ?? args;
  const result = await pollCondition(page, cond, timeoutMs, intervalMs);
  if (!result.ok) {
    throw new Error(`等待条件超时(${timeoutMs}ms): ${result.detail ?? "条件未满足"}`);
  }
  return { met: true, ...(await pageIdentity(page)) };
}

/** 断言:条件在 timeoutMs 内成立则通过,否则失败并自动截图存证据。visual 断言走像素比对。 */
export async function assertTool(config: BrowserConfig, args: Record<string, any>, exec?: ToolRunContext) {
  const page = await getPage(config);
  if (args.visual !== undefined && typeof args.visual === "object") {
    return visualAssert(config, args.visual, page, exec);
  }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 5_000) || 5_000, 100), 60_000);
  const intervalMs = Math.max(Number(args.intervalMs ?? 300) || 300, 50);
  const cond = args.condition ?? args;
  const result = await pollCondition(page, cond, timeoutMs, intervalMs);
  if (result.ok) {
    return { passed: true, ...(await pageIdentity(page)) };
  }
  // 失败:自动截图存证据目录,抛错携带原因与路径。
  const cwd = workspaceBaseDir(config, exec);
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const dir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `assert-fail-${Date.now()}.png`);
  try {
    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(filePath, buffer);
    noteScreenshotDir(dir);
    cleanupScreenshots(dir, {
      maxAgeDays: config.screenshotMaxAgeDays,
      maxCount: config.screenshotMaxCount,
    });
  } catch {
    /* 截图失败不阻断错误上报 */
  }
  throw new Error(`断言失败: ${result.detail ?? "条件未满足"}; 失败截图: ${filePath}`);
}

/**
 * 页内像素比对(自包含函数,page.evaluate 序列化注入):
 * 两张图按传入的 w/h 重绘,mask 区域填白后逐像素比较
 * (加权亮度差 / 255 > threshold 计为差异像素),差异像素在 diff 图上标红。
 * 注意:公式与测试里的 luminanceDelta 语义保持一致(0.2126/0.7152/0.0722)。
 */
async function compareImagesInPage(payload: {
  baseline: string;
  current: string;
  threshold: number;
  maskRects: { x: number; y: number; width: number; height: number }[];
  width: number;
  height: number;
}): Promise<{
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffImage: string | null;
}> {
  const load = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("image decode failed"));
      img.src = src;
    });
  const [a, b] = await Promise.all([load(payload.baseline), load(payload.current)]);
  const { width: w, height: h } = payload;
  const draw = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx;
  };
  const ctxA = draw(a);
  const ctxB = draw(b);
  for (const r of payload.maskRects) {
    for (const ctx of [ctxA, ctxB]) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
  }
  const da = ctxA.getImageData(0, 0, w, h).data;
  const db = ctxB.getImageData(0, 0, w, h).data;
  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = w;
  diffCanvas.height = h;
  const dctx = diffCanvas.getContext("2d")!;
  dctx.drawImage(b, 0, 0, w, h);
  const dd = dctx.getImageData(0, 0, w, h);
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d =
      0.2126 * Math.abs(da[i] - db[i]) +
      0.7152 * Math.abs(da[i + 1] - db[i + 1]) +
      0.0722 * Math.abs(da[i + 2] - db[i + 2]);
    if (d / 255 > payload.threshold) {
      diff++;
      dd.data[i] = 255;
      dd.data[i + 1] = 0;
      dd.data[i + 2] = 0;
      dd.data[i + 3] = 255;
    }
  }
  const total = w * h;
  return {
    diffPixels: diff,
    totalPixels: total,
    diffRatio: total > 0 ? diff / total : 0,
    diffImage: diff > 0 ? diffCanvas.toDataURL("image/png") : null,
  };
}

/**
 * 视觉回归断言:与基线截图比对。基线缺失时报错提示先建基线;
 * diffRatio 超过 maxDiffRatio 时落盘当前截图与 diff 图并抛错。
 */
async function visualAssert(
  config: BrowserConfig,
  visual: Record<string, any>,
  page: Page,
  exec?: ToolRunContext,
) {
  const baselineName = sanitizeName(String(visual.baseline ?? ""));
  if (baselineName === "") throw new Error("visual 断言需要 baseline(基线名)");
  const cwd = workspaceBaseDir(config, exec);
  const baselineDir = config.baselineDir ?? ".dsh-browser/baselines";
  const dir = isAbsolute(baselineDir) ? baselineDir : resolve(cwd, baselineDir);
  const baselinePath = join(dir, `${baselineName}.png`);
  if (!existsSync(baselinePath)) {
    throw new Error(
      `视觉基线不存在: ${baselinePath};先用 browser_screenshot { baseline: "${baselineName}" } 建立基线`,
    );
  }
  const baselineBuf = readFileSync(baselinePath);
  const currentBuf = await page.screenshot({ type: "png" });
  const baseSize = pngSize(baselineBuf);
  const curSize = pngSize(currentBuf);
  const screenshotDir = config.screenshotDir ?? ".dsh-browser/screenshots";
  const shotDir = isAbsolute(screenshotDir) ? screenshotDir : resolve(cwd, screenshotDir);

  const saveEvidence = (suffix: string, data: Buffer | string): string => {
    mkdirSync(shotDir, { recursive: true });
    const p = join(shotDir, `visual-${sanitizeName(baselineName)}-${suffix}-${Date.now()}.png`);
    writeFileSync(p, typeof data === "string" ? Buffer.from(data.split(",")[1] ?? "", "base64") : data);
    noteScreenshotDir(shotDir);
    return p;
  };

  if (baseSize.width !== curSize.width || baseSize.height !== curSize.height) {
    const currentPath = saveEvidence("current", currentBuf);
    throw new Error(
      `视觉回归失败: 尺寸不一致(基线 ${baseSize.width}x${baseSize.height},当前 ${curSize.width}x${curSize.height}); 当前截图: ${currentPath}`,
    );
  }

  // mask: 当前页上命中选择器的区域(按缩放比例换算后两图同步填白)
  const maskSelectors: string[] = Array.isArray(visual.mask) ? visual.mask.map(String) : [];
  const rawRects: { x: number; y: number; width: number; height: number }[] = [];
  for (const sel of maskSelectors) {
    const rects = await page
      .locator(sel)
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
      )
      .catch(() => []);
    rawRects.push(...rects);
  }
  // 大图先缩放到 1000px 边长再比对(性能与精度折中,README 注明)
  const scale = Math.min(1, 1000 / Math.max(curSize.width, curSize.height));
  const w = Math.max(1, Math.round(curSize.width * scale));
  const h = Math.max(1, Math.round(curSize.height * scale));

  const result = await page.evaluate(compareImagesInPage, {
    baseline: `data:image/png;base64,${baselineBuf.toString("base64")}`,
    current: `data:image/png;base64,${currentBuf.toString("base64")}`,
    threshold: Math.min(Math.max(Number(visual.threshold ?? 0.1) || 0.1, 0), 1),
    maskRects: scaleRects(rawRects, scale),
    width: w,
    height: h,
  });

  const maxDiffRatio = Math.min(Math.max(Number(visual.maxDiffRatio ?? 0.005) || 0, 0), 1);
  if (result.diffRatio > maxDiffRatio) {
    const currentPath = saveEvidence("current", currentBuf);
    const diffPath = result.diffImage !== null ? saveEvidence("diff", result.diffImage) : "(无 diff 图)";
    throw new Error(
      `视觉回归失败: diffRatio ${(result.diffRatio * 100).toFixed(3)}%(${result.diffPixels}/${result.totalPixels} 像素)> 阈值 ${(maxDiffRatio * 100).toFixed(3)}%; 当前截图: ${currentPath}; diff 图: ${diffPath}`,
    );
  }
  return {
    passed: true,
    visual: {
      baseline: baselineName,
      diffRatio: result.diffRatio,
      diffPixels: result.diffPixels,
    },
    ...(await pageIdentity(page)),
  };
}

function matchNetwork(entry: { url: string; method: string; status?: number; ok?: boolean; failed?: boolean }, f: Record<string, any>): boolean {
  // 大小写不敏感:camelCase 接口名(如 baseStationEffRule)用小写子串也能命中,
  // 防止精确匹配扑空误判"接口未调用"
  if (f.urlSubstr && !entry.url.toLowerCase().includes(String(f.urlSubstr).toLowerCase())) return false;
  if (f.method && entry.method.toUpperCase() !== String(f.method).toUpperCase()) return false;
  if (f.status !== undefined && Number(f.status) !== entry.status) return false;
  if (f.failedOnly === true && !entry.failed && (entry.status === undefined || entry.status < 400)) return false;
  return true;
}

/** urlSubstr 零命中时的相近 URL 候选(top5,去重,LCS 打分),与 what 未命中的
 * 候选体验对齐——把"子串写错"与"接口没调"区分开。 */
function urlSuggestions(entries: { url: string }[], substr: string): string[] {
  const min = substr.trim().length <= 3 ? 1 : 2;
  const seen = new Set<string>();
  const scored: { url: string; score: number }[] = [];
  for (const e of entries) {
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    scored.push({ url: e.url, score: lcsScore(substr, e.url) });
  }
  return scored
    .filter((s) => s.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.url);
}

/** 网络记录查询:list / failed / wait / clear。兼容 (args) 与 (config, args) 两种调用签名。 */
export async function networkTool(configOrArgs?: Record<string, any>, maybeArgs?: Record<string, any>) {
  const args = (maybeArgs !== undefined ? maybeArgs : configOrArgs) ?? {};
  const action = args.action ?? "list";
  const entries = networkEntries(currentProfile);
  if (action === "clear") {
    clearNetwork(currentProfile);
    return { cleared: true, entries: [] };
  }
  if (action === "wait") {
    if (!args.url) throw new Error("wait 需要 url(正则字符串)");
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 10_000) || 10_000, 1_000), 60_000);
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      const hit = [...entries]
        .reverse()
        .find((e) => {
          if (!new RegExp(String(args.url)).test(e.url)) return false;
          if (args.status !== undefined && Number(args.status) !== e.status) return false;
          return true;
        });
      if (hit !== undefined) return { matched: hit, waitMs: Date.now() - startedAt };
      await new Promise((r) => setTimeout(r, 300));
    }
    // 超时:附最近 5 条已见请求,帮助区分「正则没写对」与「请求根本没发」。
    const recent = entries.slice(-5).map(
      (e) => `${e.method} ${e.url} → ${e.failed ? "FAILED" : (e.status ?? "?")}`,
    );
    throw new Error(
      `等待接口超时(${timeoutMs}ms): ${args.url}\n` +
        (recent.length > 0 ? `最近已见请求:\n  ${recent.join("\n  ")}` : "期间无任何接口请求记录"),
    );
  }
  const filter = action === "failed" ? { failedOnly: true } : args;
  const list = [...entries].reverse().filter((e) => matchNetwork(e, filter)).slice(0, Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200));
  if (action === "stats") {
    // 按 host 聚合:总数/失败数/平均耗时/状态码分布(测试收尾一屏看完)。
    const byHost = new Map<string, { host: string; total: number; failed: number; totalMs: number; withDuration: number; byStatus: Record<string, number> }>();
    for (const e of entries) {
      let host: string;
      try {
        host = new URL(e.url).host;
      } catch {
        host = "(invalid-url)";
      }
      let bucket = byHost.get(host);
      if (bucket === undefined) {
        bucket = { host, total: 0, failed: 0, totalMs: 0, withDuration: 0, byStatus: {} };
        byHost.set(host, bucket);
      }
      bucket.total++;
      if (e.failed === true || (e.status !== undefined && e.status >= 400)) bucket.failed++;
      if (e.durationMs !== undefined) {
        bucket.totalMs += e.durationMs;
        bucket.withDuration++;
      }
      if (e.status !== undefined) {
        const key = String(e.status);
        bucket.byStatus[key] = (bucket.byStatus[key] ?? 0) + 1;
      }
    }
    const stats = [...byHost.values()]
      .map((b) => ({
        host: b.host,
        total: b.total,
        failed: b.failed,
        avgMs: b.withDuration > 0 ? Math.round(b.totalMs / b.withDuration) : null,
        byStatus: b.byStatus,
      }))
      .sort((a, b) => b.total - a.total);
    return { stats };
  }
  if (action === "failed") {
    const suggestions = list.length === 0 && args.urlSubstr ? urlSuggestions(entries, String(args.urlSubstr)) : [];
    return suggestions.length > 0 ? { failed: list, suggestions } : { failed: list };
  }
  if (action === "list") {
    const suggestions = list.length === 0 && args.urlSubstr ? urlSuggestions(entries, String(args.urlSubstr)) : [];
    return suggestions.length > 0 ? { entries: list, suggestions } : { entries: list };
  }
  throw new Error(`unknown network action: ${action}`);
}
