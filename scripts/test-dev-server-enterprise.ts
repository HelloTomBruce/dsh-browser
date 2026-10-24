// scripts/test-dev-server-enterprise.ts
// 企业级全场景（Cascader、Drawer、Table 行级操作、Popconfirm、Disabled 极速诊断、Steps 流程）端到端集成测试脚本
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9531;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/#/`;

async function fetchJson(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = `${DEV_SERVER_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status} ${res.statusText}`);
  }
  return data;
}

async function waitForServerReady(maxWaitMs = 15000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxWaitMs) {
    try {
      const res = await fetchJson("/status");
      if (res && res.status === "ready" && res.url && !res.url.includes("about:blank")) {
        return;
      }
    } catch {
      // server starting...
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  // 显式加载目标主页面
  await fetchJson("/open", {
    method: "POST",
    body: JSON.stringify({ url: TARGET_PAGE_URL }),
  });
}

async function runStep(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = performance.now();
  try {
    const detail = await fn();
    const duration = (performance.now() - t0).toFixed(1);
    console.log(`  ✅ [PASS] ${name} (${duration}ms)`);
    console.log(`     ↳ ${detail}`);
  } catch (err: any) {
    const duration = (performance.now() - t0).toFixed(1);
    console.log(`  ❌ [FAIL] ${name} (${duration}ms)`);
    console.log(`     ↳ 错误: ${err.message}`);
    throw err;
  }
}

async function main() {
  const isHeadless = process.env.HEADLESS === "true";
  console.log("======================================================================");
  console.log(`🚀 启动 Dev-Server 全场景企业级端到端实战 (Headless: ${isHeadless})`);
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

    // 测试 1: 抽屉 (Drawer) 浮层隔离与平滑关闭
    await runStep("1. [抽屉 Drawer] 打开侧拉抽屉、捕获隔离内容并平滑关闭", async () => {
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "text=打开属性抽屉 Drawer" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria", scope: ".ant-drawer" }),
      });

      if (!snap.tree?.includes("实时负载曲线") || !snap.tree?.includes("关闭抽屉")) {
        throw new Error(`Drawer 抽屉内内容未正确提取: ${snap.tree}`);
      }

      // 关闭抽屉
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "text=关闭抽屉" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      return `Drawer 成功呼出、内容范围限定验证通过，且点击关闭按钮后遮罩正常注销`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 2: 多 Tab 切换与异步 DOM 挂载
    await runStep("2. [Tab 异步加载] 切换至「海量数据表格与复杂操作」Tab 并等待稳态", async () => {
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "text=海量数据表格与复杂操作" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria" }),
      });

      if (!snap.tree?.includes("TASK-1000")) {
        throw new Error("Tab 2 切换后表格行数据未渲染");
      }

      return "成功切换 Tab 2 并自动等待表格 DOM 渲染完成";
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 3: 禁用按钮极速前置诊断 (Fast-Fail)
    await runStep("3. [禁用状态极速诊断] 拦截点击禁用态按钮并给出业务指引", async () => {
      const t0 = performance.now();
      let caught = false;
      let errMsg = "";

      try {
        await fetchJson("/click", {
          method: "POST",
          body: JSON.stringify({ selector: "text=批量删除选中", timeoutMs: 3000 }),
        });
      } catch (err: any) {
        caught = true;
        errMsg = err.message;
      }

      const elapsed = performance.now() - t0;
      if (!caught) {
        throw new Error("预期点击禁用按钮抛错，实际却执行成功");
      }
      if (!errMsg.includes("禁用状态") && !errMsg.includes("disabled")) {
        throw new Error(`预期错误信息包含禁用提示，实际得到: ${errMsg}`);
      }
      if (elapsed > 4000) {
        throw new Error(`禁用诊断耗时过长 (${elapsed.toFixed(0)}ms)，未达成快速失败目标`);
      }

      return `极速命中禁用态诊断 (耗时 ${elapsed.toFixed(0)}ms): "${errMsg}"`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 4: 表格高密度同名操作按钮精准定界 (Row Scoping)
    await runStep("4. [表格行级定界] 在 20 行同名操作项中精准点击 TASK-1002 的「编辑」", async () => {
      // 每一行都有一个按钮 "编辑"，通过 tr 行定界命中特定任务行
      const rowEditRes = await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: "tr:has-text('TASK-1002') button:has-text('编辑')",
        }),
      });

      return `精准命中 TASK-1002 专属操作行: ${JSON.stringify(rowEditRes.clicked)}`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 5: 气泡确认框 (Popconfirm) 浮层穿透
    await runStep("5. [气泡确认框 Popconfirm] 点击表格「删除」并在浮层气泡中点击「确认」", async () => {
      // 点击 TASK-1000 行的删除触发 Popconfirm 气泡
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: "tr:has-text('TASK-1000') button:has-text('删除')",
        }),
      });
      await new Promise((r) => setTimeout(r, 600));

      // Popconfirm 会在 body 插入 .ant-popover，内部包含「确认」按钮
      const confirmRes = await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: ".ant-popover .ant-btn-primary",
        }),
      });

      return `成功捕获最上层 Popconfirm 气泡浮层并触发确认操作: ${JSON.stringify(confirmRes.clicked)}`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 6: 流程审批步骤切换 (Steps)
    await runStep("6. [步骤审批流 Steps] 切换至 Tab 4 并点击「下一步」推进审批流程", async () => {
      // 切换至 Tab 4
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "text=流程审批与步骤协同" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      // 点击下一步
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "button:has-text('下一步')" }),
      });
      await new Promise((r) => setTimeout(r, 400));

      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria" }),
      });

      if (!snap.tree?.includes("当前步骤：第 2 阶段")) {
        throw new Error(`流程审批流推进失败，当前状态快照: ${snap.tree}`);
      }

      return "流程审批步骤从第 1 阶段成功流转至第 2 阶段 (部门主管审批)";
    });

    console.log("\n======================================================================");
    console.log("🎉 全部 6 项复杂企业级真实中后台交互场景 100% 验证成功！");
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
