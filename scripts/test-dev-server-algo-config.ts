// scripts/test-dev-server-algo-config.ts
// 针对实际业务反馈（:visible 伪类报错、eval 语法不一致、多选叠加残留、表格操作二次确认未触发）的完整真机端到端复现与验证
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9532;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/#/WirelessPowerSaving/ObjectSceneRecognitionAlgoConfig`;

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
      if (res && res.status === "ready") {
        if (!res.url || !res.url.includes("ObjectSceneRecognitionAlgoConfig")) {
          await fetchJson("/open", {
            method: "POST",
            body: JSON.stringify({ url: TARGET_PAGE_URL }),
          });
          await new Promise((r) => setTimeout(r, 1000));
        }
        return;
      }
    } catch {
      // server starting...
    }
    await new Promise((r) => setTimeout(r, 400));
  }
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
  console.log(`🚀 启动 Dev-Server: 算法配置业务页面专项实战 (Headless: ${isHeadless})`);
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
    console.log("✓ 算法配置页面在真实浏览器中已加载就绪！\n");

    // 测试 1: 验证 :visible 伪类在 scope 中正常解析，不再抛出 SyntaxError
    await runStep("1. [:visible 伪类兼容] browser_snapshot 支持 scope: '.ant-select-dropdown:visible'", async () => {
      // 先点击展开地市下拉触发框 (支持直接定位 #city-select 智能提升到交互容器)
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "#city-select" }),
      });
      await new Promise((r) => setTimeout(r, 600));

      // 关键测试: 曾报 SyntaxError: not a valid selector
      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria", scope: ".ant-select-dropdown:visible" }),
      });

      if (!snap.tree || !snap.tree.includes("杭州市")) {
        throw new Error(`使用 :visible 作为 scope 未能提取到可见下拉项: ${snap.tree}`);
      }

      // 选定杭州市
      await fetchJson("/select", {
        method: "POST",
        body: JSON.stringify({ selector: "#city-select", option: "杭州市" }),
      });

      return `成功识别带有 :visible 的 scope 伪类并提取展开选项，DOM 未抛出 SyntaxError`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 2: 验证 eval 条件下的 return 语法统一支持 (不再报 Illegal return statement)
    await runStep("2. [eval 语法统一] browser_assert 支持 'return ...' 语句块与表达式", async () => {
      // 关键测试: 曾报 SyntaxError: Illegal return statement
      const assertRes = await fetchJson("/assert", {
        method: "POST",
        body: JSON.stringify({
          eval: "return document.querySelector('#district-select') !== null && !document.querySelector('#district-select').classList.contains('ant-select-disabled');",
        }),
      });

      if (!assertRes.passed) {
        throw new Error(`断言执行未通过: ${JSON.stringify(assertRes)}`);
      }

      return `断言引擎成功识别带 'return' 的语句块，与 browser_eval 保持一致语法宽容度`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 3: 验证多选 Select 支持替换清理 (clear: true)，避免选项叠加残留 (滨江区 + 西湖区)
    await runStep("3. [多选叠加自愈] browser_select 支持 clear: true 清理前置残留项", async () => {
      // 点击新增打开 Modal
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: "#add-btn" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      // 此时表单中默认有「滨江区」，我们要换成「西湖区」，使用 clear: true
      await fetchJson("/select", {
        method: "POST",
        body: JSON.stringify({
          selector: "#modal-districts-select",
          option: "西湖区",
          clear: true,
        }),
      });
      await new Promise((r) => setTimeout(r, 400));

      // 检查当前多选容器内是否只剩「西湖区」，而非「滨江区, 西湖区」
      const selectedTexts = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({
          script: "return Array.from(document.querySelectorAll('.ant-select:has(#modal-districts-select) .ant-select-selection-item-content')).map(el => el.textContent.trim());",
        }),
      });

      if (!Array.isArray(selectedTexts.result) || selectedTexts.result.length !== 1 || selectedTexts.result[0] !== "西湖区") {
        throw new Error(`多选清理失败，实际存在项: ${JSON.stringify(selectedTexts.result)}`);
      }

      // 关闭弹窗
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({ selector: ".ant-modal-footer button:has-text('取消')" }),
      });
      await new Promise((r) => setTimeout(r, 500));

      return `成功清理前置残留选项，多选容器严格保留最新选择项: ${JSON.stringify(selectedTexts.result)}`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 4: 表格行级定界定位与操作 (Row Scoping)
    await runStep("4. [表格行级定界] 使用 row 与 action 精准命中「杭州高密商业区」的「删除」", async () => {
      // 使用增强的 row 与 action 语义定位
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          row: "杭州高密商业区",
          action: "删除",
        }),
      });
      await new Promise((r) => setTimeout(r, 500));

      // 验证当前呼出的是 Modal.confirm 二次确认弹窗 (包含 ant-modal-confirm)
      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria", scope: ".ant-modal-confirm" }),
      });

      if (!snap.tree || !snap.tree.includes("确认删除")) {
        throw new Error(`未能成功调起「确认删除」二次确认对话框: ${snap.tree}`);
      }

      return "精准命中指定行的删除操作，成功唤起 Modal.confirm 二次确认弹窗";
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 5: 二次确认点击与真实网络请求捕获 (排除合成事件不触发陷阱)
    await runStep("5. [二次确认网络派发] 点击确认弹窗「确 定」并验证接口请求真实发送", async () => {
      // 确认按钮处于 .ant-modal-confirm-btns 内
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: ".ant-modal-confirm-btns .ant-btn-primary",
        }),
      });
      await new Promise((r) => setTimeout(r, 600));

      // 检查网络请求记录
      const networkLog = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({
          script: "return window.__networkRequests || [];",
        }),
      });

      const deleteReq = (networkLog.result || []).find((req: any) => req.endpoint === "/api/deleteObjSceneConfig");
      if (!deleteReq) {
        throw new Error(`网络记录中未找到删除接口请求: ${JSON.stringify(networkLog.result)}`);
      }

      return `确认点击被 Vue 成功处理并触发网络请求: ${JSON.stringify(deleteReq)}`;
    });
    await new Promise((r) => setTimeout(r, 800));

    // 测试 6: Switch 停用二次确认流程
    await runStep("6. [Switch 启停二次确认] 点击 Switch 触发确认弹窗并确认变更", async () => {
      // 定位西湖景区的 switch
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: "tr:has-text('西湖景区') button[role='switch']",
        }),
      });
      await new Promise((r) => setTimeout(r, 500));

      // 点击弹窗「确 定」
      await fetchJson("/click", {
        method: "POST",
        body: JSON.stringify({
          selector: ".ant-modal-confirm-btns .ant-btn-primary",
        }),
      });
      await new Promise((r) => setTimeout(r, 600));

      const networkLog = await fetchJson("/eval", {
        method: "POST",
        body: JSON.stringify({
          script: "return window.__networkRequests || [];",
        }),
      });

      const updateReq = (networkLog.result || []).find((req: any) => req.endpoint === "/api/updateEnableFlag");
      if (!updateReq) {
        throw new Error(`未检测到启停网络请求: ${JSON.stringify(networkLog.result)}`);
      }

      return `Switch 启停二次确认成功完成闭环，更新接口派发: ${JSON.stringify(updateReq)}`;
    });

    console.log("\n======================================================================");
    console.log("🎉 全部 6 项业务痛点端到端复现与深度校验 100% 成功！");
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
