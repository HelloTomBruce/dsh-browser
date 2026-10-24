// scripts/test-panel-pick.ts
// M3 面板点选教学(browser_pick_element)本地端到端测试 —— 无需 DSH 环境:
//   真实浏览器(playground/shadow-dom.html)+ 生产面板 API(registerBrowserApi
//   挂在临时 HTTP 服务,与 DSH web 宿主同一注册路径)+ 脚本模拟「面板用户
//   在大图上点击」(与 InspectionModal 的 letterbox 几何互为逆运算)。
//
// 覆盖链路:工具挂起 → GET /pick 轮询到 PendingPick → GET /screenshot 取帧
// 尺寸 → 按钮 CSS 坐标 → 位图坐标换算 → POST /pick → 工具返回 picked:true
// (selector/指纹/ref)→ 返回的 ref 直接 clickTool 生效;外加超时路径与
// 空点(missed)路径。React 面板 UI(十字光标/横幅)需真实 DSH,不在本脚本
// 范围(几何换算即 handleImageClick 的逆运算,已由坐标换算步骤间接验证)。
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { openTool, pickTool, clickTool, evalTool } from "../src/browser/tools.js";
import { registerBrowserApi } from "../src/browser/ui.js";
import { closeBrowser, getPage } from "../src/browser/session.js";
import { pngSize } from "../src/browser/tools/common.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { ReefContext, WebRoute } from "../src/lib/types.js";
import { performance } from "node:perf_hooks";

const PANEL_PORT = 9543;
const PANEL_BASE = `http://127.0.0.1:${PANEL_PORT}`;
const PAGE_URL = "http://127.0.0.1:5173/shadow-dom.html";

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

async function main() {
  console.log("======================================================================");
  console.log(`🚀 M3 面板点选教学端到端测试 (Headless: ${config.headless})`);
  console.log(`🌐 目标页面: ${PAGE_URL} · 🔌 面板 API: ${PANEL_BASE}/browser/*`);
  console.log("======================================================================\n");

  // 1) 生产面板 API 挂到临时 HTTP 服务(fake webServer 宿主,与 DSH 同注册面)
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

  // 2) 静态托管 playground(shadow-dom.html 所需;与 dev-server 的兜底同款)
  const staticProc = spawn("npx", ["tsx", "-e", `
    import http from "node:http"; import { readFileSync } from "node:fs";
    http.createServer((q, s) => {
      const p = (q.url ?? "/").split("?")[0];
      try { s.writeHead(200, {"content-type":"text/html"}); s.end(readFileSync("playground" + (p === "/" ? "/shadow-dom.html" : p))); }
      catch { s.writeHead(404); s.end("nf"); }
    }).listen(5173, "127.0.0.1");
  `], { stdio: "ignore", cwd: process.cwd() });
  await sleep(1500);

  try {
    // 打开测试页(真实浏览器)
    await openTool(config, { url: PAGE_URL });
    await sleep(600);

    const j = async (ep: string, body?: unknown) => {
      const res = await fetch(`${PANEL_BASE}${ep}`, body !== undefined
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : undefined);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`${ep} → ${res.status}: ${JSON.stringify(data)}`);
      return data;
    };
    const fetchPng = async (ep: string) => {
      const res = await fetch(`${PANEL_BASE}${ep}`);
      if (!res.ok) throw new Error(`${ep} → ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    };

    // 测试 1: 空闲时 GET /pick 返回 null
    await runStep("1. [空闲态] GET /pick 无挂起点选请求", async () => {
      const data = await j("/browser/pick");
      if (data?.pick !== null && data?.pick !== undefined) {
        throw new Error(`应为 null,实际: ${JSON.stringify(data)}`);
      }
      return "pick: null ✓";
    });

    // 测试 2: 完整闭环 — 工具挂起 → 面板轮询 → 模拟点击 → picked:true + ref 可用
    await runStep("2. [完整闭环] 面板点选「Shadow 提交」→ selector/指纹/ref 一次拿到", async () => {
      const instruction = "请点击「Shadow 提交」按钮";
      const pickPromise = pickTool(config, { instruction, timeoutMs: 20000 });

      // 面板侧轮询(等 PendingPick 出现)
      let pending: any = null;
      for (let i = 0; i < 20 && pending === null; i++) {
        await sleep(300);
        pending = (await j("/browser/pick")).pick;
      }
      if (pending === null) throw new Error("面板 6s 内未轮询到 PendingPick");
      if (pending.instruction !== instruction) throw new Error(`instruction 不符: ${pending.instruction}`);

      // 模拟面板几何:取按钮视口 CSS 中心(shadow root 内),再按「生产面板
      // cssX = imgPx * deviceWidth / imgW」的逆运算换算成截图位图坐标
      const btn = await evalTool(config, { script: `return (() => {
        const el = document.getElementById("panel").shadowRoot.getElementById("shadow-submit");
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()` });
      const shot = await fetchPng("/browser/screenshot");
      const size = pngSize(shot);
      const viewport = (await getPage(config)).viewportSize();
      if (viewport === null) throw new Error("无法读取视口尺寸");
      const imgX = Math.round((btn.result.x * size.width) / viewport.width);
      const imgY = Math.round((btn.result.y * size.height) / viewport.height);
      // POST 点选(与 InspectionModal handleImageClick 的输出契约一致)
      const accepted = await j("/browser/pick", {
        id: pending.id, x: imgX, y: imgY, imgW: size.width, imgH: size.height,
      });
      if (accepted?.accepted !== true) throw new Error(`POST 被拒: ${JSON.stringify(accepted)}`);

      const result: any = await pickPromise;
      if (result.picked !== true || result.status !== "picked") {
        throw new Error(`未命中: ${JSON.stringify(result)}`);
      }
      if (result.role !== "button" || !result.name.includes("Shadow 提交")) {
        throw new Error(`描述不符: ${result.role}"${result.name}"`);
      }
      // 指纹与自愈链兼容
      if (result.hint?.tag !== "button") throw new Error(`指纹缺失: ${JSON.stringify(result.hint)}`);

      // 返回的 ref 直接点击生效(闭环到既有定位体系)
      await clickTool(config, { ref: result.ref });
      const status = await evalTool(config, { script: "document.getElementById('status').textContent" });
      if (status.result !== "Shadow 提交 已点击") {
        throw new Error(`ref 点击未生效: ${status.result}`);
      }
      // 结束后面板轮询恢复 null
      const after = await j("/browser/pick");
      if (after?.pick !== null) throw new Error("完成后 pending 未清理");
      return `picked: ${result.role}"${result.name}" → ${result.selector} [ref=${result.ref}] → 点击生效,面板已清场`;
    });

    // 测试 3: 空点(missed)— 点在空白处返回 missed 不抛错
    await runStep("3. [空点] 点击空白区域返回 missed(坐标换算正确但无元素)", async () => {
      const pickPromise = pickTool(config, { timeoutMs: 8000 });
      let pending: any = null;
      for (let i = 0; i < 20 && pending === null; i++) {
        await sleep(300);
        pending = (await j("/browser/pick")).pick;
      }
      const shot = await fetchPng("/browser/screenshot");
      const size = pngSize(shot);
      // 页面右下角空白区(状态栏右侧)
      await j("/browser/pick", { id: pending.id, x: size.width - 10, y: size.height - 6, imgW: size.width, imgH: size.height });
      const result: any = await pickPromise;
      if (result.picked !== false || result.status !== "missed") {
        throw new Error(`应为 missed: ${JSON.stringify(result)}`);
      }
      return result.detail;
    });

    // 测试 4: 超时(timedOut)— 无人点击不抛错
    await runStep("4. [超时] 无人点选返回 timedOut(不抛错)", async () => {
      const result: any = await pickTool(config, { timeoutMs: 1200 });
      if (result.picked !== false || result.status !== "timedOut") {
        throw new Error(`应为 timedOut: ${JSON.stringify(result)}`);
      }
      return result.detail;
    });

    console.log("\n======================================================================");
    console.log("🎉 M3 面板点选教学 4 项场景 100% 验证成功!");
    console.log("======================================================================\n");
  } finally {
    try {
      await closeBrowser();
    } catch {
      /* ignore */
    }
    panel.close();
    staticProc.kill("SIGKILL");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
