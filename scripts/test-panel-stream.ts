// scripts/test-panel-stream.ts
// 实时画面流端到端测试 —— 无需 DSH 环境:真实浏览器(playground)+ 生产面板
// API(registerBrowserApi 挂临时 HTTP 服务)。走 SSE 分支(Accept: text/event-stream)
// 验证 v0.7.5 推模型改造:
//   1) 订阅后帧到达(CDP screencast 激活,everyNthFrame:1);
//   2) 新开标签页(registerTabPage 换活动页)后,订阅不断线的情况下流跟随新页出帧
//      —— 回归「绑定首页永不换绑」;
//   3) 活动页关闭(流应停)+ 再次 openTool 自愈新页(流复活)
//      —— 回归「页面关闭后永不重启」。
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { openTool } from "../src/browser/tools.js";
import { registerBrowserApi } from "../src/browser/ui.js";
import { closeBrowser, getPage, newPage, registerTabPage, stateOf } from "../src/browser/session.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { ReefContext, WebRoute } from "../src/lib/types.js";
import { performance } from "node:perf_hooks";

const PANEL_PORT = 9544;
const PANEL_BASE = `http://127.0.0.1:${PANEL_PORT}`;
const PAGE_A = "http://127.0.0.1:5174/shadow-dom.html";
const PAGE_B = "http://127.0.0.1:5174/clickable-span.html";

const config: BrowserConfig = {
  channel: "auto",
  headless: process.env.HEADLESS !== "false",
  timeoutMs: 15000,
  screenshotDir: ".dsh-browser/screenshots",
  screenshotMaxAgeDays: 7,
  screenshotMaxCount: 200,
  basePath: "/browser",
  toolset: "all",
} as BrowserConfig;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runStep(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    console.log(`  ✅ [PASS] ${name} (${(performance.now() - t0).toFixed(1)}ms)`);
    console.log(`     ↳ ${detail}`);
  } catch (err: any) {
    console.log(`  ❌ [FAIL] ${name} (${(performance.now() - t0).toFixed(1)}ms)`);
    console.log(`     ↳ 错误: ${err.message}`);
    throw err;
  }
}

interface StreamFrame {
  timestamp: number;
  metadata: Record<string, any>;
}

/** 订阅 SSE 流,返回帧观察器(按时间窗收集)。 */
async function subscribeStream(): Promise<{
  frames: StreamFrame[];
  abort: () => Promise<void>;
}> {
  const controller = new AbortController();
  const res = await fetch(`${PANEL_BASE}/browser/stream`, {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream → ${res.status}`);
  const frames: StreamFrame[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              if (typeof payload?.timestamp === "number") frames.push(payload);
            } catch {
              /* 非 JSON 行忽略 */
            }
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, abort: async () => controller.abort() };
}

/** 等到窗口期内出现新帧(after 之后),超时报错。 */
async function waitForFrame(frames: StreamFrame[], after: number, timeoutMs: number): Promise<StreamFrame> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const hit = frames.find((f) => f.timestamp > after);
    if (hit !== undefined) return hit;
    if (performance.now() > deadline) {
      throw new Error(`等待新帧超时 ${timeoutMs}ms(共 ${frames.length} 帧)`);
    }
    await sleep(100);
  }
}

/** 触发页面重绘(静态页不重绘就不产帧,这是 CDP screencast 机制)。 */
async function triggerRepaint(): Promise<void> {
  const page = await getPage(config);
  await page.evaluate(() => {
    document.body.style.background = document.body.style.background === "rgb(255, 238, 238)" ? "" : "rgb(255, 238, 238)";
  });
}

async function main() {
  console.log("======================================================================");
  console.log(`🚀 实时画面流端到端测试 (Headless: ${config.headless})`);
  console.log(`🌐 目标页面: ${PAGE_A} · 🔌 面板 API: ${PANEL_BASE}/browser/*`);
  console.log("======================================================================\n");

  // 1) 生产面板 API 挂临时 HTTP 服务(与 DSH web 宿主同一注册路径)
  const routes: WebRoute[] = [];
  const fakeCtx = {
    get: (name: string) =>
      name === "webServer"
        ? { register: (r: WebRoute) => { routes.push(r); return () => {}; } }
        : undefined,
    effect: () => () => {},
  } as unknown as ReefContext;
  registerBrowserApi(fakeCtx, config, "/browser");
  const panel = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split("?")[0] ?? "";
    const route = routes.find((r) => r.kind === "prefix" && path.startsWith(r.path));
    if (route) void route.handler(req, res);
    else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((r) => panel.listen(PANEL_PORT, "127.0.0.1", r));

  // 2) 静态托管 playground
  const staticProc = spawn("npx", ["tsx", "-e", `
    import http from "node:http"; import { readFileSync } from "node:fs";
    http.createServer((q, s) => {
      const p = (q.url ?? "/").split("?")[0];
      try {
        const body = readFileSync("playground" + (p === "/" ? "/shadow-dom.html" : p));
        s.writeHead(200, {"content-type": "text/html"});
        s.end(body);
      } catch { s.writeHead(404); s.end("nf"); }
    }).listen(5174, "127.0.0.1");
  `], { stdio: "ignore", cwd: process.cwd() });
  await sleep(1500);

  try {
    await openTool(config, { url: PAGE_A });
    await sleep(600);
    const { frames, abort } = await subscribeStream();

    // 测试 1: 订阅后帧到达(CDP 激活 + 广播)
    await runStep("1. [订阅出帧] SSE 订阅后 CDP screencast 帧到达", async () => {
      const since = Date.now();
      await triggerRepaint();
      const f = await waitForFrame(frames, since, 8000);
      return `帧到达,元数据键: ${Object.keys(f.metadata).slice(0, 4).join(",")}`;
    });

    // 测试 2: 新开标签页 → 流跟随新活动页(订阅不断线)
    await runStep("2. [换页跟随] 新标签页成为活动页后,同一订阅继续收到新页的帧", async () => {
      const p2 = await newPage(config);
      registerTabPage(stateOf(), p2);
      await p2.goto(PAGE_B, { waitUntil: "domcontentloaded" });
      await sleep(400);
      const since = Date.now();
      // 在新活动页上触发重绘;若流仍绑旧页,这里永远等不到新帧
      await triggerRepaint();
      const f = await waitForFrame(frames, since, 8000);
      return `新页帧到达(ts=${new Date(f.timestamp).toISOString()}),流已跟随活动标签`;
    });

    // 测试 3: 关闭活动页 → 流停;openTool 自愈新页 → 流复活
    await runStep("3. [关闭自愈] 活动页关闭后流停止,openTool 新页后同一订阅恢复出帧", async () => {
      const page = await getPage(config);
      await page.close();
      await sleep(600);
      const countAtClose = frames.length;
      await sleep(1200);
      if (frames.length > countAtClose) {
        throw new Error(`页面关闭后不应继续产帧(关闭前 ${countAtClose},现在 ${frames.length})`);
      }

      await openTool(config, { url: PAGE_A }); // activeTabClosed 自愈:新标签
      await sleep(400);
      const since = Date.now();
      await triggerRepaint();
      const f = await waitForFrame(frames, since, 8000);
      return `流复活,新页帧到达(ts=${new Date(f.timestamp).toISOString()}),订阅全程未断`;
    });

    await abort();
    console.log("\n🎉 全部通过:实时画面流「换页跟随/关闭自愈」行为符合预期");
  } finally {
    try { await closeBrowser(); } catch { /* ignore */ }
    staticProc.kill();
    panel.close();
  }
}

main().catch((err) => {
  console.error("\n💥 测试失败:", err);
  process.exitCode = 1;
});
