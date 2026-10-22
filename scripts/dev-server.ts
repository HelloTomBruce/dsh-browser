// dsh-browser · 常驻 Dev 控制器服务 (完整能力版)
import http from "node:http";
import { resolve } from "node:path";
import { closeBrowser, getPage } from "../src/browser/session.js";
import {
  clickTool,
  findTool,
  networkTool,
  openTool,
  screenshotTool,
  selectTool,
  snapshotTool,
  typeTool,
} from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  channel: "auto",
  executablePath: "",
  headless: false,
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

async function startServer() {
  const PORT = 9527;
  const initialUrl = "http://127.0.0.1:7001/#/WirelessPowerSaving/SitePowerSavingDispatch/BasicEnergySaving";

  console.log("=================================================");
  console.log("🚀 dsh-browser 完整能力控制器启动中...");
  console.log(`🌐 目标页面: ${initialUrl}`);
  console.log(`🔌 控制端点: http://127.0.0.1:${PORT}`);
  console.log("=================================================\n");

  await openTool(config, { url: initialUrl, waitUntil: "domcontentloaded" });

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
        const clickRes = await clickTool(config, body);
        return sendJson(res, 200, clickRes);
      }

      if (pathname === "/type" && req.method === "POST") {
        const body = await readJson(req);
        const typeRes = await typeTool(config, body);
        return sendJson(res, 200, typeRes);
      }

      if (pathname === "/select" && req.method === "POST") {
        const body = await readJson(req);
        const selRes = await selectTool(config, body);
        return sendJson(res, 200, selRes);
      }

      if (pathname === "/scroll" && req.method === "POST") {
        const body = await readJson(req);
        const deltaX = Number(body.deltaX ?? 0);
        let deltaY = Number(body.deltaY ?? 500);
        if (body.direction === "up") deltaY = -Math.abs(deltaY);
        else if (body.direction === "down") deltaY = Math.abs(deltaY);

        const selector = body.selector;
        if (selector) {
          const res = await page.locator(selector).first().evaluate((el, { dy, dx }) => {
            const before = { top: el.scrollTop, left: el.scrollLeft };
            el.scrollBy({ top: dy, left: dx, behavior: "instant" });
            return { before, after: { top: el.scrollTop, left: el.scrollLeft } };
          }, { dy: deltaY, dx: deltaX });
          return sendJson(res, 200, { ok: true, target: selector, ...res });
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
        const result = await page.evaluate(new Function("return (" + script + ")()") as any);
        return sendJson(res, 200, { ok: true, result });
      }

      if (pathname === "/screenshot" && req.method === "POST") {
        const body = await readJson(req);
        const name = body.name || `shot-${Date.now()}.png`;
        const shotRes = await screenshotTool(config, { name }, exec);
        return sendJson(res, 200, shotRes);
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

  server.listen(PORT, () => {
    console.log(`✅ 完整能力控制器就绪 (http://127.0.0.1:${PORT})`);
  });
}

startServer().catch((e) => {
  console.error("启动失败:", e);
  process.exit(1);
});
