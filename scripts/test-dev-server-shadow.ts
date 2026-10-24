// scripts/test-dev-server-shadow.ts
// Shadow DOM 组合树穿透端到端测试:快照 aria / find / what 语义定位 / ref 点击 /
// shadow 内输入。前置:playground vite 已在 5173 运行(cd playground && pnpm dev)。
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9536;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/shadow-dom.html`;

async function fetchJson(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = `${DEV_SERVER_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status} ${res.statusText}`);
  return data;
}

async function waitForServerReady(maxWaitMs = 15000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    try {
      const res = await fetchJson("/status");
      if (res && res.status === "ready" && res.url && !res.url.includes("about:blank")) return;
    } catch {
      // server starting...
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("dev-server 未就绪");
}

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
  const isHeadless = process.env.HEADLESS === "true";
  console.log("======================================================================");
  console.log(`🚀 Shadow DOM 组合树穿透端到端测试 (Headless: ${isHeadless})`);
  console.log(`🌐 目标页面: ${TARGET_PAGE_URL}`);
  console.log(`🔌 控制端点: ${DEV_SERVER_URL}`);
  console.log("======================================================================\n");

  let serverProc: ChildProcess | null = null;
  serverProc = spawn("npx", ["tsx", "scripts/dev-server.ts", TARGET_PAGE_URL], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(DEV_SERVER_PORT),
      HEADLESS: isHeadless ? "true" : "false",
      URL: TARGET_PAGE_URL,
      USER_DATA_DIR: "",
    },
    stdio: "inherit",
  });

  try {
    console.log("⏳ 等待 Dev-Server 与浏览器就绪...");
    await waitForServerReady();
    console.log("✓ Dev-Server 及其真实浏览器上下文已就绪！\n");

    // 测试 1: aria 快照穿透 — 一层 shadow 内的按钮/输入框进树并带 ref
    await runStep("1. [快照穿透] 一层 shadow 内的可交互元素进 aria 树", async () => {
      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria" }),
      });
      for (const label of ["Shadow 提交", "Shadow 删除", "Shadow 用户名"]) {
        if (!snap.tree?.includes(label)) {
          throw new Error(`aria 树缺失一层 shadow 元素「${label}」: ${snap.tree}`);
        }
      }
      return "一层 shadow 内的 提交/删除/用户名 全部出现在 aria 树";
    });

    // 测试 2: 两层嵌套 shadow 穿透
    await runStep("2. [深嵌套穿透] 两层嵌套 shadow 内的按钮进树", async () => {
      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria" }),
      });
      if (!snap.tree?.includes("深层 Shadow 登录")) {
        throw new Error(`aria 树缺失两层嵌套 shadow 元素: ${snap.tree}`);
      }
      return "两层嵌套 shadow 内的「深层 Shadow 登录」出现在 aria 树";
    });

    // 测试 3: find 语义查找 + ref 点击一层 shadow 按钮
    await runStep("3. [find+ref 点击] find 定位一层 shadow 按钮并按 ref 点击生效", async () => {
      const found = await fetchJson("/find", {
        method: "POST",
        body: JSON.stringify({ query: "Shadow 提交" }),
      });
      if (found.found < 1) throw new Error(`find 未命中: ${JSON.stringify(found)}`);
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ ref: found.matches[0].ref }),
      });
      const text = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({ script: "document.getElementById('status').textContent" }),
      });
      if (text.result !== "Shadow 提交 已点击") {
        throw new Error(`点击未生效,状态: ${text.result}`);
      }
      return `ref=${found.matches[0].ref} 点击生效,页面状态更新为「${text.result}」`;
    });

    // 测试 4: what 语义定位两层嵌套 shadow 按钮(打分扫描 + 自动注册 ref)
    await runStep("4. [what 语义] 一次调用定位并点击两层嵌套 shadow 按钮", async () => {
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ what: "深层 Shadow 登录" }),
      });
      const text = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({ script: "document.getElementById('status').textContent" }),
      });
      if (text.result !== "深层 Shadow 登录 已点击") {
        throw new Error(`what 点击未生效,状态: ${text.result}`);
      }
      return `what:"深层 Shadow 登录" 一次调用命中两层嵌套 shadow 按钮`;
    });

    // 测试 5: shadow 内输入框 what 定位 + 输入
    await runStep("5. [shadow 输入] what 定位 shadow 内输入框并输入", async () => {
      await fetchJson("/type", {
        method: "POST",
        body: JSON.stringify({ what: "Shadow 用户名", text: "dsh-shadow-test", clear: true }),
      });
      const text = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({
          script: "document.getElementById('panel').shadowRoot.getElementById('shadow-input').value",
        }),
      });
      if (text.result !== "dsh-shadow-test") {
        throw new Error(`输入未生效,输入框值: ${text.result}`);
      }
      return "shadow 内输入框填入成功";
    });

    console.log("\n======================================================================");
    console.log("🎉 Shadow DOM 组合树穿透 5 项场景 100% 验证成功！");
    console.log("======================================================================\n");
  } finally {
    try {
      await fetchJson("/close", { method: "POST" }).catch(() => {});
    } catch {
      /* ignore */
    }
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGKILL");
    }
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
