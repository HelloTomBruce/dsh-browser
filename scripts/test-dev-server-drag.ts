// scripts/test-dev-server-drag.ts
// browser_drag 端到端测试:HTML5 原生拖放 / 鼠标拖动看板 / 跨 Frame 拖动 /
// 参数缺失诊断。自包含:dev-server 对 5173 自动托管 playground 静态页。
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9541;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/drag.html`;

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

/** 期望失败的调用:返回 { ok, error } 而不抛错。 */
async function tryFetchJson(endpoint: string, options: RequestInit = {}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${DEV_SERVER_URL}${endpoint}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, error: data?.error ?? String(res.status) };
}

async function waitForServerReady(maxWaitMs = 30000): Promise<void> {
  const t0 = Date.now();
  let lastErr = "";
  // 阶段一:等 HTTP 服务可应答(此阶段 /status 可能与 openTool 的 getPage 并发,
  // 拿到的可能是尚未导航的 about:blank 页)
  while (Date.now() - t0 < maxWaitMs) {
    try {
      await fetchJson("/status");
      break;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  // 阶段二:显式导航一次(幂等),消除 about:blank 竞态,再校验落点
  while (Date.now() - t0 < maxWaitMs) {
    try {
      await fetchJson("/goto", { method: "POST", body: JSON.stringify({ url: TARGET_PAGE_URL }) });
      const res = await fetchJson("/status");
      if (res && res.status === "ready" && res.url && !res.url.includes("about:blank")) return;
      lastErr = `status=${JSON.stringify(res)}`.slice(0, 200);
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev-server 未就绪 (last: ${lastErr})`);
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

async function evalOnPage(script: string): Promise<any> {
  const r = await fetchJson("/eval", { method: "POST", body: JSON.stringify({ script }) });
  return r.result;
}

async function main() {
  const isHeadless = process.env.HEADLESS === "true";
  console.log("======================================================================");
  console.log(`🚀 browser_drag 端到端测试 (Headless: ${isHeadless})`);
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

    // 测试 1: HTML5 原生拖放(dragstart/dragover/drop + dataTransfer)
    await runStep("1. [HTML5 DnD] source/target 选择器拖放,drop 区收到条目", async () => {
      const r = await fetchJson("/drag", {
        method: "POST",
        body: JSON.stringify({ source: "#item-1", target: "#html5-zone" }),
      });
      if (r.dragged !== true) throw new Error(`dragged !== true: ${JSON.stringify(r)}`);
      if (r.via !== "dragTo") throw new Error(`HTML5 用例应走 dragTo 通道,via=${JSON.stringify(r.via)}`);
      for (const key of ["source", "target", "url", "title"]) {
        if (typeof r[key] !== "string") throw new Error(`返回缺 ${key}: ${JSON.stringify(r)}`);
      }
      const dropped = await evalOnPage(`return document.querySelector('#html5-zone').dataset.lastDropped;`);
      if (dropped !== "条目一") throw new Error(`drop 区未收到条目一,lastDropped=${JSON.stringify(dropped)}`);
      return `dragged=true via=dragTo, drop 区收到 "${dropped}", 返回字段完整`;
    });

    // 测试 2: 鼠标拖动看板(dragTo 失败路径 → 物理鼠标序列)
    await runStep("2. [鼠标拖动] 看板卡片拖到另一列(mouse 事件序列生效)", async () => {
      await fetchJson("/drag", {
        method: "POST",
        body: JSON.stringify({ source: "#card-a", target: "#col-done" }),
      });
      const parent = await evalOnPage(`return document.querySelector('#card-a').parentElement.id;`);
      if (parent !== "col-done") throw new Error(`任务 A 仍在 ${parent},未拖到 col-done`);
      return `任务 A 已移入 #${parent}`;
    });

    // 测试 3: 跨 Frame 拖动(源在主页面,目标 ref 在 iframe 内 → 物理鼠标 + via:"mouse")
    await runStep("3. [跨 Frame] 主页面卡片拖进 iframe(targetRef 解析)", async () => {
      const snap = await fetchJson("/snapshot", {
        method: "POST",
        body: JSON.stringify({ mode: "aria" }),
      });
      const tree: string = snap.tree ?? "";
      // iframe 内的按钮带 f{idx}:e{N} 形态 ref
      const line = tree.split("\n").find((l) => l.includes("提交子系统校验") && /\[ref=f\d+:e\d+\]/.test(l));
      if (!line) throw new Error(`aria 快照未找到 iframe 内按钮 ref:${tree.slice(0, 300)}`);
      const zoneRef = (line.match(/\[ref=(f\d+:e\d+)\]/) ?? [])[1];
      if (!zoneRef) throw new Error(`ref 解析失败: ${line}`);
      const r = await fetchJson("/drag", {
        method: "POST",
        body: JSON.stringify({ source: "#card-x", targetRef: zoneRef }),
      });
      if (r.via !== "mouse") throw new Error(`跨 Frame 应走 mouse 通道,via=${JSON.stringify(r.via)}`);
      const received = await evalOnPage(
        `return document.getElementById('frame-drop').contentDocument.getElementById('frame-drop-marker').dataset.received;`,
      );
      if (received !== "1") throw new Error("iframe 放开标记未收到 mouseup");
      return `targetRef=${zoneRef} 命中,via=mouse,iframe 标记已收到拖入`;
    });

    // 测试 4: 参数缺失诊断
    await runStep("4. [诊断] 缺 target 定位 → 明确报错", async () => {
      const r = await tryFetchJson("/drag", {
        method: "POST",
        body: JSON.stringify({ source: "#item-1" }),
      });
      if (r.ok) throw new Error("缺 target 不应成功");
      if (!/target/.test(r.error ?? "")) throw new Error(`报错未指向 target: ${r.error}`);
      return `报错符合预期: ${r.error}`;
    });

    // 测试 5: 源零命中诊断
    await runStep("5. [诊断] 源选择器零命中 → 报错含选择器", async () => {
      const r = await tryFetchJson("/drag", {
        method: "POST",
        body: JSON.stringify({ source: "#no-such-src", target: "#html5-zone", timeoutMs: 2000 }),
      });
      if (r.ok) throw new Error("零命中源不应成功");
      if (!/源元素|no-such-src/.test(r.error ?? "")) throw new Error(`报错未指向源定位: ${r.error}`);
      return `报错符合预期: ${(r.error ?? "").slice(0, 80)}`;
    });

    console.log("\n======================================================================");
    console.log("🎉 全部 5 项 browser_drag 端到端测试通过!");
    console.log("======================================================================");
  } finally {
    if (serverProc) {
      try {
        await fetchJson("/close", { method: "POST" }).catch(() => {});
      } catch {
        // ignore
      }
      serverProc.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("\n💥 测试失败:", err.message);
  process.exit(1);
});
