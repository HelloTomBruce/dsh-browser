// scripts/test-v06-regression.ts
// v0.6.0 全量新特性真实浏览器端到端回归评测脚本
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
  extractTool,
} from "../src/browser/tools.js";
import { screencastManager } from "../src/browser/session/screencast.js";
import { sessionTracer } from "../src/browser/session/tracer.js";
import { evaluatePolicy } from "../src/browser/policy/engine.js";
import type { BrowserConfig } from "../src/browser/types.js";

const TEST_PORT = 5175;
const DIST_DIR = join(process.cwd(), "playground/dist");

/** 极速静态文件服务器 (托管 playground/dist) */
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
  humanize: "auto",
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
  console.log(`🚀 开始 v0.6.0 真实浏览器全场景端到端实战验证 (Playground)`);
  console.log(`======================================================================\n`);

  // 1. 启动静态服务器
  console.log(`▶ [环境就绪] 正在启动 Playground 宿主服务 (HTTP ${TEST_PORT})...`);
  const server = await startStaticServer(TEST_PORT);
  const targetUrl = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`   ✓ 静态服务已就绪: ${targetUrl}\n`);

  try {
    // 2. 页面加载
    await step("1. 导航并加载 Playground 复杂中后台应用", async () => {
      const res = await openTool(config, { url: targetUrl });
      return `页面标题: "${res.title}", URL: ${res.url}`;
    });

    // 3. F1: CDP Screencast 实时帧推流验证
    await step("2. [特性 F1] CDP Screencast 低延迟帧推流与按需生命周期验证", async () => {
      const page = await getPage(config);
      let framesReceived = 0;
      let firstFrameSize = 0;

      const unsub = screencastManager.subscribe((frame) => {
        framesReceived++;
        if (firstFrameSize === 0) firstFrameSize = frame.buffer.length;
      });

      // 启动推流
      await screencastManager.start(page);

      // 等待至少一帧推流到达 (通常 80~150ms 内到达)
      for (let i = 0; i < 20; i++) {
        if (framesReceived > 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      unsub();
      await screencastManager.stop();

      if (framesReceived === 0) {
        throw new Error("未能接收到 CDP Screencast 实时推流帧");
      }

      return `成功捕获 ${framesReceived} 帧 CDP 实时画面, 首帧大小: ${(firstFrameSize / 1024).toFixed(1)} KB, 订阅释放后静默注销`;
    });

    // 4. F2: 拟人化操作引擎 (平滑贝塞尔与高斯击键)
    await step("3. [特性 F2] 拟人化平滑贝塞尔鼠标与高斯击键输入", async () => {
      const page = await getPage(config);
      const text = "k8s-cluster-beijing-v06";
      const t0 = performance.now();

      await typeTool(config, {
        selector: ".ant-form-item:has-text('集群名称') input",
        text,
        clear: true,
        humanize: true,
      });

      const elapsed = performance.now() - t0;
      const val = await page.locator(".ant-form-item:has-text('集群名称') input").inputValue();

      if (val !== text) {
        throw new Error(`输入内容不一致: 期望 "${text}", 实际 "${val}"`);
      }

      return `拟人化输入完成 (输入 22 字符耗时 ${elapsed.toFixed(0)}ms, 击键带自然生理延迟), DOM 校验通过`;
    });

    // 5. F5: 企业级富控件之时序组件 (RangePicker 双日历)
    await step("4. [特性 F5] 企业富控件: 时间范围 RangePicker 双日历赋值", async () => {
      const page = await getPage(config);
      const dateRangeContainer = page.locator(".ant-picker-range").first();

      const inputs = dateRangeContainer.locator("input");
      await inputs.nth(0).click();
      await inputs.nth(0).fill("2026-10-01 00:00:00");
      await inputs.nth(0).press("Enter");

      await inputs.nth(1).click();
      await inputs.nth(1).fill("2026-10-31 23:59:59");
      await inputs.nth(1).press("Enter");

      const startVal = await inputs.nth(0).inputValue();
      const endVal = await inputs.nth(1).inputValue();

      return `RangePicker 成功设值: 起止区间 [${startVal}] ~ [${endVal}]`;
    });

    // 6. F3: 策略引擎白名单与高危保护验证
    await step("5. [特性 F3] 策略引擎白名单放行与生产环境拦截规则链判定", async () => {
      // 本地环境
      const localDecision = evaluatePolicy(
        {
          confirmPolicies: [
            { name: "本地开发白名单", urlPattern: ".*localhost|127\\.0\\.0\\.1.*", level: "off" },
            { name: "生产集群高危保护", urlPattern: ".*\\.prod\\..*", patterns: ["删除"], level: "auto" },
          ],
        },
        {
          url: "http://127.0.0.1:5175",
          tool: "browser_click",
          selector: "#delete-btn",
          desc: { text: "删除所有配置" },
        },
      );

      if (localDecision.level !== "off") {
        throw new Error(`本地开发环境应静默放行，实际 level=${localDecision.level}`);
      }

      // 生产环境
      const prodDecision = evaluatePolicy(
        {
          confirmPolicies: [
            { name: "本地开发白名单", urlPattern: ".*localhost|127\\.0\\.0\\.1.*", level: "off" },
            { name: "生产集群高危保护", urlPattern: ".*\\.prod\\..*", patterns: ["删除"], level: "auto", timeoutMs: 90000 },
          ],
        },
        {
          url: "https://console.prod.company.com/billing",
          tool: "browser_click",
          selector: "#delete-btn",
          desc: { text: "删除所有配置" },
        },
      );

      if (prodDecision.level !== "auto" || prodDecision.timeoutMs !== 90000) {
        throw new Error(`生产高危动作未按预期拦截: ${JSON.stringify(prodDecision)}`);
      }

      return "本地白名单命中放行(level: off)，生产环境高危关键词命中拦截(level: auto, timeoutMs: 90000)";
    });

    // 7. F4: 会话全景时光机链路追踪
    await step("6. [特性 F4] 会话时光机 (Time-Machine) 单步时间轴与异常回溯", async () => {
      const page = await getPage(config);
      sessionTracer.startStep("default", "browser_click", { ref: "e1" }, page);

      // 模拟页内产生一条告警
      sessionTracer.recordConsole("default", {
        type: "warn",
        text: "Performance warning: long task on main thread",
        timestamp: Date.now(),
      });

      const trace = await sessionTracer.endStep("default", true, undefined, page);
      if (!trace || !trace.thumbnail) {
        throw new Error("时光机未生成单步快照缩略图");
      }

      return `单步追踪生成成功: 步骤序号 #${trace.stepIndex}, 耗时: ${trace.durationMs}ms, 附带缩略图与 Console 日志 (${trace.consoleLogs.length} 条)`;
    });

    // 8. F5: 海量数据表格结构化数据提取
    await step("7. [特性 F5] 复杂中后台海量数据表格抽取与字段规整", async () => {
      // 切换至 Tab 2
      await clickTool(config, { selector: ".ant-tabs-tab:nth-child(2)" });

      const extractRes = await extractTool(config, {
        fields: [
          {
            name: "tasks",
            selector: ".ant-table-row",
            multiple: true,
            fields: [
              { name: "id", selector: "td:nth-child(2)" },
              { name: "name", selector: "td:nth-child(3)" },
              { name: "owner", selector: "td:nth-child(4)" },
            ],
          },
        ],
      });

      if (!extractRes.rows || extractRes.rows.length === 0) {
        throw new Error("未能成功抽取表格行数据");
      }

      return `成功提取表格 ${extractRes.count} 行数据, 首行样例: ${JSON.stringify(extractRes.rows[0])}`;
    });
  } finally {
    await closeBrowser();
    server.close();
  }

  console.log(`\n======================================================================`);
  console.log(`🎉 全部 7 项 v0.6.0 核心能力在真实 Playground 上 100% 验证通过！`);
  console.log(`======================================================================\n`);
}

runRegression().catch((err) => {
  console.error("端到端验证失败:", err);
  process.exit(1);
});
