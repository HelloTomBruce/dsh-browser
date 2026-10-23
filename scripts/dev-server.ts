// dsh-browser · 常驻 Dev 控制器服务 (完整能力版)
import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { closeBrowser, getPage } from "../src/browser/session.js";
import {
  clickTool,
  findTool,
  formFillTool,
  networkTool,
  openTool,
  screenshotTool,
  selectTool,
  snapshotTool,
  typeTool,
  transferTool,
  dragTool,
  extractTool,
} from "../src/browser/tools.js";
import { screencastManager } from "../src/browser/session/screencast.js";
import { sessionTracer } from "../src/browser/session/tracer.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  channel: "auto",
  executablePath: "",
  headless: process.env.HEADLESS === "true" ? true : false,
  userDataDir: resolve(".dsh-browser/dev-profile"),
  profiles: {},
  screenshotDir: ".dsh-browser/screenshots",
  downloadDir: ".dsh-browser/downloads",
  workspaceDir: process.cwd(),
  screenshotMaxAgeDays: 7,
  screenshotMaxCount: 200,
  basePath: "/browser",
  recordBodies: true,
  maxTextChars: 20000,
  maxLinks: 50,
  timeoutMs: 30000,
  baselineDir: ".dsh-browser/baselines",
  selectorHealing: true,
  healTimeoutMs: 3000,
  maxRefs: 200,
  maxRows: 1000,
  snapshotHistory: 5,
  confirmMode: "off",
  confirmTimeoutMs: 60000,
  sensitivePatterns: ["提交", "删除", "支付"],
  sensitiveTools: ["browser_click"],
  confirmInReplay: true,
  toolset: "all",
};

const exec = { signal: new AbortController().signal };

function sendJson(res: http.ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function runWithTrace<T>(toolName: string, body: any, fn: () => Promise<T>): Promise<T> {
  const page = await getPage(config);
  sessionTracer.startStep("default", toolName, body, page);
  try {
    const res = await fn();
    await sessionTracer.endStep("default", true, undefined, page);
    return res;
  } catch (err: any) {
    await sessionTracer.endStep("default", false, err.message, page);
    throw err;
  }
}

function startStaticPlaygroundServer(port: number): Promise<http.Server | null> {
  const mimeMap: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
  };
  const distDir = resolve("playground/dist");
  return new Promise((res) => {
    const s = http.createServer((req, resp) => {
      const urlPath = req.url?.split("?")[0] || "/";
      let filePath = resolve(distDir, urlPath === "/" ? "index.html" : `.${urlPath}`);
      if (urlPath === "/iframe-subpage.html") {
        filePath = resolve("playground/iframe-subpage.html");
      }
      if (existsSync(filePath)) {
        const ext = extname(filePath);
        resp.writeHead(200, { "Content-Type": mimeMap[ext] || "application/octet-stream" });
        resp.end(readFileSync(filePath));
      } else {
        resp.writeHead(404);
        resp.end(`Not Found: ${urlPath}`);
      }
    });
    s.once("error", () => res(null));
    s.listen(port, () => res(s));
  });
}

async function startServer() {
  const PORT = Number(process.env.PORT) || 9527;
  const initialUrl = process.argv[2] || process.env.URL || "http://127.0.0.1:5173";

  // 若目标为 5173，自动开启零依赖静态托管 Playground
  if (initialUrl.includes("5173")) {
    const srv = await startStaticPlaygroundServer(5173);
    if (srv) {
      console.log(`📦 Playground 静态托管已自启: http://127.0.0.1:5173`);
    }
  }

  console.log("=================================================");
  console.log("🚀 dsh-browser 完整能力控制器启动中...");
  console.log(`🌐 目标页面: ${initialUrl}`);
  console.log(`🔌 控制端点: http://127.0.0.1:${PORT}`);
  console.log("=================================================\n");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;

    try {
      const page = await getPage(config);

      if (pathname === "/status" && req.method === "GET") {
        return sendJson(res, 200, {
          url: page.url(),
          title: await page.title(),
          status: "ready",
        });
      }

      if (pathname === "/goto" && req.method === "POST") {
        const body = await readJson(req);
        const target = String(body.url || "").trim();
        if (!target) return sendJson(res, 400, { error: "url is required" });
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
        return sendJson(res, 200, {
          ok: true,
          url: page.url(),
          title: await page.title(),
        });
      }

      if (pathname === "/snapshot" && req.method === "POST") {
        const body = await readJson(req);
        const snap = await snapshotTool(config, body);
        return sendJson(res, 200, snap);
      }

      if (pathname === "/find" && req.method === "POST") {
        const body = await readJson(req);
        const findRes = await findTool(config, body);
        return sendJson(res, 200, findRes);
      }

      if (pathname === "/click" && req.method === "POST") {
        const body = await readJson(req);
        const clickRes = await runWithTrace("browser_click", body, () => clickTool(config, body));
        return sendJson(res, 200, clickRes);
      }

      if (pathname === "/type" && req.method === "POST") {
        const body = await readJson(req);
        const typeRes = await runWithTrace("browser_type", body, () => typeTool(config, body));
        return sendJson(res, 200, typeRes);
      }

      if (pathname === "/select" && req.method === "POST") {
        const body = await readJson(req);
        const selRes = await runWithTrace("browser_select", body, () => selectTool(config, body));
        return sendJson(res, 200, selRes);
      }

      if (pathname === "/fill" && req.method === "POST") {
        const body = await readJson(req);
        const fillRes = await runWithTrace("browser_fill", body, () => formFillTool(config, body));
        return sendJson(res, 200, fillRes);
      }

      if (pathname === "/scroll" && req.method === "POST") {
        const body = await readJson(req);
        const deltaX = Number(body.deltaX ?? 0);
        let deltaY = Number(body.deltaY ?? 500);
        if (body.direction === "up") deltaY = -Math.abs(deltaY);
        else if (body.direction === "down") deltaY = Math.abs(deltaY);

        const selector = body.selector;
        if (selector) {
          const scrollRes = await page.locator(selector).first().evaluate((el, { dy, dx }) => {
            const before = { top: el.scrollTop, left: el.scrollLeft };
            el.scrollBy({ top: dy, left: dx, behavior: "instant" });
            return { before, after: { top: el.scrollTop, left: el.scrollLeft } };
          }, { dy: deltaY, dx: deltaX });
          return sendJson(res, 200, { ok: true, target: selector, ...scrollRes });
        }

        // 默认:物理滚轮 + 自动嗅探内层滚动容器
        await page.mouse.move(600, 400);
        await page.mouse.wheel(deltaX, deltaY);
        await page.waitForTimeout(300);

        // 如果物理滚轮未使容器滚动(部分无头或特殊内联 overflow),自动兜底滚动页面主容器
        const metrics = await page.evaluate(({ dy }) => {
          let container = document.querySelector(".page-content") as HTMLElement | null;
          if (!container || container.scrollHeight <= container.clientHeight) {
            const all = Array.from(document.querySelectorAll("*")) as HTMLElement[];
            container = all.find((el) => {
              const cs = window.getComputedStyle(el);
              return (cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight;
            }) || (document.scrollingElement as HTMLElement) || document.documentElement;
          }
          const before = container.scrollTop;
          if (before === 0 && dy > 0) {
            container.scrollBy({ top: dy, behavior: "instant" });
          }
          return {
            containerTag: container.tagName,
            containerClass: container.className,
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
          };
        }, { dy: deltaY });

        return sendJson(res, 200, { ok: true, metrics });
      }

      if (pathname === "/eval" && req.method === "POST") {
        const body = await readJson(req);
        const script = String(body.script || "");
        let result: any;
        try {
          result = await page.evaluate(script);
        } catch {
          result = await page.evaluate(`(() => { return (${script}); })()`);
        }
        return sendJson(res, 200, { ok: true, result });
      }

      if (pathname === "/screenshot" && req.method === "POST") {
        const body = await readJson(req);
        const name = body.name || `shot-${Date.now()}.png`;
        const shotRes = await screenshotTool(config, { name }, exec);
        return sendJson(res, 200, shotRes);
      }

      if (pathname === "/transfer" && req.method === "POST") {
        const body = await readJson(req);
        const transRes = await runWithTrace("browser_transfer", body, () => transferTool(config, body));
        return sendJson(res, 200, transRes);
      }

      if (pathname === "/drag" && req.method === "POST") {
        const body = await readJson(req);
        const dragRes = await runWithTrace("browser_drag", body, () => dragTool(config, body));
        return sendJson(res, 200, dragRes);
      }

      if (pathname === "/extract" && req.method === "POST") {
        const body = await readJson(req);
        const extRes = await runWithTrace("browser_extract", body, () => extractTool(config, body, exec));
        return sendJson(res, 200, extRes);
      }

      if (pathname === "/timeline" && req.method === "GET") {
        return sendJson(res, 200, {
          traces: sessionTracer.getTraces("default"),
        });
      }

      if (pathname === "/stream" && req.method === "GET") {
        res.writeHead(200, {
          "content-type": "multipart/x-mixed-replace; boundary=--frame",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });

        const unsubscribe = screencastManager.subscribe((frame) => {
          try {
            res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`);
            res.write(frame.buffer);
            res.write("\r\n");
          } catch {
            /* closed */
          }
        });

        req.on("close", () => {
          unsubscribe();
        });
        return;
      }

      if (pathname === "/close" && req.method === "POST") {
        sendJson(res, 200, { ok: true });
        setTimeout(async () => {
          await closeBrowser();
          server.close();
          process.exit(0);
        }, 500);
        return;
      }

      sendJson(res, 404, { error: `Not found: ${pathname}` });
    } catch (e) {
      console.error("请求处理出错:", e);
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  server.listen(PORT, async () => {
    console.log(`✅ 完整能力控制器就绪 (http://127.0.0.1:${PORT})`);
    const initialUrl = process.env.URL || "http://127.0.0.1:5173";
    console.log(`🌐 正在打开真实浏览器窗口: ${initialUrl} (headless: ${config.headless})`);
    try {
      await openTool(config, { url: initialUrl });
      console.log(`🎉 真实浏览器窗口已就绪！`);
    } catch (e: any) {
      console.warn(`浏览器打开提示: ${e.message}`);
    }
  });
}

startServer().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
