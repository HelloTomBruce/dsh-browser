// scripts/test-v05-regression.ts
// v0.5.0 全量核心能力真实浏览器端到端回归评测脚本
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { getPage, closeBrowser } from "../src/browser/session.js";
import {
  openTool,
  snapshotTool,
  clickTool,
  typeTool,
  formFillTool,
  screenshotTool,
  recordTool,
} from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const TEST_PORT = 5174;
const DIST_DIR = join(process.cwd(), "playground/dist");

/** 极速静态文件服务器 (零第三方依赖托管 playground/dist) */
function startStaticServer(port: number): Promise<http.Server> {
  const mimeMap: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
  };

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      let filePath = join(DIST_DIR, urlPath === "/" ? "index.html" : urlPath);

      // 特别支持 iframe-subpage.html 直接映射
      if (urlPath === "/iframe-subpage.html") {
        filePath = join(process.cwd(), "playground/iframe-subpage.html");
      }

      if (existsSync(filePath)) {
        const ext = extname(filePath);
        const contentType = mimeMap[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end("Not Found: " + urlPath);
      }
    });

    server.listen(port, () => {
      resolve(server);
    });
  });
}

const config: BrowserConfig = {
  channel: "auto",
  headless: true,
  timeoutMs: 15000,
};

interface StepResult {
  name: string;
  durationMs: number;
  passed: boolean;
  detail: string;
}

const results: StepResult[] = [];

async function step(name: string, fn: () => Promise<string>) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    const durationMs = Number((performance.now() - t0).toFixed(2));
    results.push({ name, durationMs, passed: true, detail });
    console.log(`  ✅ [PASS] ${name} (${durationMs}ms)`);
    console.log(`     ↳ ${detail}`);
  } catch (err: any) {
    const durationMs = Number((performance.now() - t0).toFixed(2));
    results.push({ name, durationMs, passed: false, detail: err.message });
    console.log(`  ❌ [FAIL] ${name} (${durationMs}ms)`);
    console.log(`     ↳ 错误: ${err.message}`);
    throw err;
  }
}

async function runRegression() {
  console.log(`\n======================================================================`);
  console.log(`🚀 开始 v0.5.0 真实浏览器全场景端到端回归评测`);
  console.log(`======================================================================\n`);

  // 1. 启动静态服务器
  console.log(`▶ [环境就绪] 正在启动 Playground 宿主服务 (HTTP ${TEST_PORT})...`);
  const server = await startStaticServer(TEST_PORT);
  const targetUrl = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`   ✓ 静态服务已就绪: ${targetUrl}\n`);

  try {
    // 2. 页面加载
    await step("1. 导航并加载 Playground 主应用", async () => {
      const res = await openTool(config, { url: targetUrl });
      return `页面标题: "${res.title}", URL: ${res.url}`;
    });

    // 3. 切换到 Tab 5
    await step("2. 点击进入「v0.5.0 核心能力专项回归」Tab", async () => {
      const page = await getPage(config);
      const tab5Btn = page.getByRole("tab", { name: "v0.5.0 核心能力专项回归" }).first();
      await tab5Btn.click({ timeout: 5000 });
      await page.waitForTimeout(500);
      return "已成功切换至 Tab 5 专项回归视口";
    });

    // 4. F2: 视口感知动态快照
    await step("3. [特性 F2] 视口感知快照 (viewportOnly) 几何相交剪枝", async () => {
      const fullSnap = await snapshotTool(config, { mode: "aria" });
      const vpSnap = await snapshotTool(config, { mode: "aria", viewportOnly: true });

      if (!vpSnap.viewportOnly) {
        throw new Error("快照返回值未标明 viewportOnly: true");
      }
      if ((vpSnap.prunedCount ?? 0) <= 0) {
        throw new Error(`预期修剪视口外节点 > 0，实际 prunedCount=${vpSnap.prunedCount}`);
      }

      const ratio = (((fullSnap.tree?.length || 1) - (vpSnap.tree?.length || 1)) / (fullSnap.tree?.length || 1) * 100).toFixed(1);
      return `全量字符: ${fullSnap.tree?.length}, 视口字符: ${vpSnap.tree?.length} (节省 ${ratio}%), 修剪节点: ${vpSnap.prunedCount}`;
    });

    // 5. F1: 跨 Frame 树合成与穿透定位
    await step("4. [特性 F1] 跨 Frame 树合成与子 Frame 元素穿透交互", async () => {
      const snap = await snapshotTool(config, { mode: "aria" });
      if (!snap.tree?.includes("--- [frame:")) {
        throw new Error("ARIA 快照树中未检测到子 Frame 分割标记 (--- [frame: ...])");
      }

      const page = await getPage(config);
      // 定位子 Frame 内的输入框与提交按钮
      const subFrame = page.frames().find((f) => f.url().includes("iframe-subpage.html"));
      if (!subFrame) throw new Error("未找到子 Frame 实例");

      const tokenInput = subFrame.locator("#sub-token");
      await tokenInput.fill("SEC-AUTH-V05-PASS");

      const submitBtn = subFrame.locator("#sub-submit-btn");
      await submitBtn.click();

      await subFrame.locator("#sub-status").waitFor({ state: "visible", timeout: 3000 });
      const statusText = await subFrame.locator("#sub-status").innerText();
      if (!statusText.includes("SEC-AUTH-V05-PASS")) {
        throw new Error(`子 Frame 未成功响应输入: ${statusText}`);
      }

      return `子 Frame 交互成功穿透并响应: "${statusText}"`;
    });

    // 6. F3: 批量智能表单填充
    await step("5. [特性 F3] 批量表单智能填充 (browser_form_fill)", async () => {
      const fillRes = await formFillTool(config, {
        fields: {
          "应用英文标识": "quantum-settle-service",
          "部署区域": "上海",
          "启用高可用容灾": true,
        },
        submitButton: "立即生成部署计划",
      });

      if (!fillRes.filled.includes("应用英文标识") || !fillRes.filled.includes("部署区域")) {
        throw new Error(`字段未能完整填充: ${JSON.stringify(fillRes)}`);
      }
      if (!fillRes.submitted) {
        throw new Error(`自动提交未成功触发: ${JSON.stringify(fillRes.errors)}`);
      }

      const page = await getPage(config);
      const alert = page.locator("#v05-submit-alert");
      await alert.waitFor({ state: "visible", timeout: 3000 });
      const alertText = await alert.innerText();

      return `批量填写完成 (成功 ${fillRes.filled.length} 项), 页面响应: "${alertText}"`;
    });

    // 7. F4: 多模态 SoM 标徽截图与即时自清
    await step("6. [特性 F4] 多模态 SoM (Set-of-Marks) 视口标徽与无痕自清", async () => {
      const page = await getPage(config);
      const shotRes = await screenshotTool(config, {
        name: "e2e-som-regression",
        som: true,
        somColor: "green",
      });

      if (!shotRes.som || !Array.isArray(shotRes.somMarks) || shotRes.somMarks.length === 0) {
        throw new Error(`未成功生成 SoM 标徽映射: ${JSON.stringify(shotRes)}`);
      }

      // 验证截图后 DOM 零残留
      const residual = await page.evaluate(() => document.getElementById("__dsh_som_overlay__"));
      if (residual !== null) {
        throw new Error("页面依然残留 SoM 覆盖层 DOM 节点，未能做到无痕自清！");
      }

      return `成功合成 ${shotRes.somMarks.length} 个视口标徽, 标徽文件已保存, DOM 零残留验证通过`;
    });

    // 8. F5: 原生 Playwright Spec 规范代码导出
    await step("7. [特性 F5] 录制动作序列并一键导出原生 Playwright 规范代码", async () => {
      // 启动录制并执行真实动作
      await recordTool({ action: "start" });
      await clickTool(config, { selector: "#som-btn-1" });
      await recordTool({ action: "stop" });
      await recordTool({ action: "save", name: "v05-e2e-flow" });

      const exportRes = await recordTool({
        action: "export",
        name: "v05-e2e-flow",
        format: "playwright",
      });

      if (!exportRes.code?.includes("import { test, expect } from \"@playwright/test\";")) {
        throw new Error("导出的 Playwright 代码不符合规范标准");
      }
      if (!exportRes.code?.includes("#som-btn-1")) {
        throw new Error("导出的代码中未包含点击步骤");
      }

      return `代码成功转译导出 (长度 ${exportRes.code.length} 字符):\n\n${exportRes.code.split("\n").slice(0, 10).map((l) => "        " + l).join("\n")}\n        ... (后续用例省略)`;
    });

    console.log(`\n======================================================================`);
    console.log(`🎉 全部 7 项 v0.5.0 专项端到端回归评测 100% 顺利通过！`);
    console.log(`======================================================================\n`);
  } finally {
    await closeBrowser();
    server.close();
  }
}

runRegression().catch((e) => {
  console.error("评测执行失败:", e);
  process.exit(1);
});
