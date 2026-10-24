// scripts/test-dev-server-energy.ts
// 针对会话实际痛点（无 href 链接、同构隐藏 Dropdown、空态 Select、Modal Scope）的 dev-server 端到端验证脚本
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9529;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/#/WirelessPowerSaving/EnergySavingOverview`;

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
  // 若页面尚未完成导航，显式调用 /open 加载目标页面
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
  console.log(`🚀 启动 Dev-Server 与真实浏览器 (Headless: ${isHeadless})`);
  console.log(`🌐 目标页面: ${TARGET_PAGE_URL}`);
  console.log(`🔌 控制端点: ${DEV_SERVER_URL}`);
  console.log("======================================================================\n");

  // 1. 启动 dev-server 子进程 (默认有头模式 headless: false，可直观看到浏览器界面)
  let serverProc: ChildProcess | null = null;
  serverProc = spawn("npx", ["tsx", "scripts/dev-server.ts", TARGET_PAGE_URL], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(DEV_SERVER_PORT),
      HEADLESS: isHeadless ? "true" : "false",
      URL: TARGET_PAGE_URL,
    },
    stdio: "inherit",
  });

  try {
    console.log("⏳ 等待 Dev-Server 与浏览器就绪...");
    await waitForServerReady();
    console.log("✓ Dev-Server 及其真实浏览器上下文已就绪！\n");

    // 测试 1: 验证无 href 的自定义 a 标签被推断为可交互 button
    await runStep("1. [语义推断] browser_find 查找无 href 的日期下拉触发器「2026-10-22」", async () => {
      const findRes = await fetchJson("/find", {
        method: "POST",
        body: JSON.stringify({ query: "2026-10-22" }),
      });
      if (!findRes.found || findRes.matches.length === 0) {
        throw new Error(`未能找到元素「2026-10-22」: ${JSON.stringify(findRes)}`);
      }
      const buttonMatch = findRes.matches.find((m: any) => m.role === "button");
      if (!buttonMatch) {
        throw new Error(`预期存在推断为 button 角色的触发器，实际命中列表: ${JSON.stringify(findRes.matches)}`);
      }
      return `成功识别无 href 的自定义下拉链接为 button [ref=${buttonMatch.ref}], 匹配项: "${buttonMatch.name}"`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 2: 验证网络维度标签「4G能耗」被识别
    await runStep("2. [语义推断] browser_find 查找无 href 的网络维度触发器「4G能耗」", async () => {
      const findRes = await fetchJson("/find", {
        method: "POST",
        body: JSON.stringify({ query: "4G能耗" }),
      });
      if (!findRes.found || findRes.matches.length === 0) {
        throw new Error(`未能找到元素「4G能耗」: ${JSON.stringify(findRes)}`);
      }
      return `成功命中网络维度按钮 [ref=${findRes.matches[0].ref}]`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 3: 验证可见性仲裁（Smart Visibility Arbitration）
    // 页面同时存在隐藏的城市下拉项与展开的日期下拉项，均包含 .ant-dropdown-menu-item
    await runStep("3. [可见性仲裁] 存在同名隐藏下拉时，browser_click 优先命中可见下拉项", async () => {
      // 在修改前，click .ant-dropdown-menu-item 会命中隐藏的第一个节点 (城市下拉的 3300) 导致 "Element is not visible"
      // 在修改后，应自动跳过隐藏节点，精准点击处于可见状态的 "2026-10-20"
      const clickRes = await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: ".ant-dropdown-menu-item",
        }),
      });

      // 验证页面状态是否成功响应了点击
      const evalRes = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({
          script: "document.getElementById('badge-date').textContent",
        }),
      });

      if (evalRes.result !== "2026-10-20") {
        throw new Error(`页面日期未被更新为 2026-10-20，当前为: ${evalRes.result}`);
      }

      return `点击成功，自动绕过隐藏下拉项，命中可见项，页面日期更新为: ${evalRes.result}`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 4: 验证多个同构浮层时的 scope 选取
    await runStep("4. [浮层 Scope] 存在多个同构容器时，browser_snapshot 优先获取展开可见的浮层", async () => {
      // 重新点击日期触发器展开浮层
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "#date-link" }),
      });
      await new Promise((r) => setTimeout(r, 400));

      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({
          mode: "aria",
          scope: ".ant-dropdown",
        }),
      });

      if (!snap.tree || !snap.tree.includes("2026-10-21")) {
        throw new Error(`快照未能命中展开的可见日期下拉内容，快照树为:\n${snap.tree}`);
      }

      return `scope: '.ant-dropdown' 成功选取展开的浮层，捕获到日期菜单选项:\n${snap.tree
        .split("\n")
        .map((l: string) => "        " + l)
        .join("\n")}`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 5: 验证 Select 下拉空态精准识别
    await runStep("5. [空态识别] browser_select 针对无数据的空态下拉给出明确提示", async () => {
      let errMsg = "";
      try {
        await fetchJson("/select", {
          method: "POST",
          body: JSON.stringify({
            selector: "#scene-select",
            option: "场景",
          }),
        });
      } catch (err: any) {
        errMsg = err.message;
      }

      if (!errMsg.includes("空态") && !errMsg.includes("无可选数据")) {
        throw new Error(`预期捕获空态提示，实际错误信息为: ${errMsg}`);
      }

      return `精准识别下拉空态: "${errMsg}"`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 6: 验证弹窗 Modal 打开及 Scope 定位
    await runStep("6. [弹窗 Modal] 点击「设 置」并以 scope='.ant-modal' 提取表单元素", async () => {
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "#setting-btn" }),
      });

      const modalSnap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({
          mode: "aria",
          scope: ".ant-modal",
        }),
      });

      if (!modalSnap.tree || !modalSnap.tree.includes("概览指标卡片")) {
        throw new Error(`弹窗 ARIA 树未获取到设置表单内容: ${modalSnap.tree}`);
      }

      return `弹窗内提取到表单与按钮:\n${modalSnap.tree
        .split("\n")
        .map((l: string) => "        " + l)
        .join("\n")}`;
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 测试 7: 弹窗 Scope 混淆时的智能提示
    await runStep("7. [容错诊断] 将 Modal 误传为 scope='.ant-drawer' 时给出精准候选提示", async () => {
      let errMsg = "";
      try {
        await fetchJson("/snapshot", {
          method: "POST",
          body: JSON.stringify({
            mode: "aria",
            scope: ".ant-drawer",
          }),
        });
      } catch (err: any) {
        errMsg = err.message;
      }

      if (!errMsg.includes(".ant-modal")) {
        throw new Error(`异常信息未提示存在 .ant-modal 候选: ${errMsg}`);
      }

      return `容错提示成功触发: "${errMsg}"`;
    });

    console.log("\n======================================================================");
    console.log("🎉 全部 7 项特定场景测试通过 Dev-Server 真实浏览器 100% 验证成功！");
    console.log("🖥️ 保持浏览器窗口打开 4 秒供观察...");
    console.log("======================================================================\n");
    await new Promise((r) => setTimeout(r, 4000));
  } finally {
    try {
      await fetchJson("/close", { method: "POST" }).catch(() => {});
    } catch {
      /* ignore */
    }
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGKILL");
    }
  }
}

main().catch((err) => {
  console.error("执行失败:", err);
  process.exit(1);
});
