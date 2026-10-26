// scripts/test-dev-server-clickable-span.ts
// 疑似可点击启发式端到端测试:what 语义定位与 SoM 标徽对「无 ARIA 角色但可点击」
// 元素(span+click)的识别。裸静态页(playground/clickable-span.html,无框架噪音),
// 接线照抄 test-dev-server-shadow.ts。前置:playground 静态托管由 dev-server 自启。
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEV_SERVER_PORT = 9537;
const DEV_SERVER_URL = `http://127.0.0.1:${DEV_SERVER_PORT}`;
const TARGET_PAGE_URL = `http://127.0.0.1:5173/clickable-span.html`;

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

async function clickWhat(what: string): Promise<string> {
  await fetchJson("/click", { method: "POST", body: JSON.stringify({ what }) });
  const text = await fetchJson("/eval", {
    method: "POST",
    body: JSON.stringify({ script: "document.getElementById('status').textContent" }),
  });
  return String(text.result ?? "");
}

async function main() {
  const isHeadless = process.env.HEADLESS === "true";
  console.log("======================================================================");
  console.log(`🚀 疑似可点击启发式端到端测试 (Headless: ${isHeadless})`);
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

    // 测试 1: cursor:pointer span —— 自定义组件最常见形态(实战"返回上一级"场景)
    await runStep("1. [pointer 特征] what 命中 cursor:pointer 的 span 并点击生效", async () => {
      const status = await clickWhat("返回上一级");
      if (status !== "返回上一级 已点击") throw new Error(`点击未生效,状态: ${status}`);
      return 'what:"返回上一级" 命中 span#back-span(cursor:pointer,无 ARIA 角色)';
    });

    // 测试 2: onclick 属性 span —— 遗留代码常见形态
    await runStep("2. [onclick 属性] what 命中内联 onclick 的 span", async () => {
      const status = await clickWhat("展开更多");
      if (status !== "展开更多 已点击") throw new Error(`点击未生效,状态: ${status}`);
      return 'what:"展开更多" 命中 span#legacy-span(onclick 属性)';
    });

    // 测试 3: tabindex span —— 键盘可聚焦的自定义控件
    await runStep("3. [tabindex 特征] what 命中 tabindex=0 的 span", async () => {
      const status = await clickWhat("收藏本页");
      if (status !== "收藏本页 已点击") throw new Error(`点击未生效,状态: ${status}`);
      return 'what:"收藏本页" 命中 span#fav-span(tabindex)';
    });

    // 测试 4: 真实按钮恒优先 —— 同名 span 与 button 并存,必须点中 button
    await runStep("4. [真实优先] 同名 span 与 button 并存,what 点中真实 button", async () => {
      const status = await clickWhat("刷新数据");
      if (status !== "真实按钮刷新 已点击") throw new Error(`点错目标,状态: ${status}`);
      return 'what:"刷新数据" 压分策略生效,button#real-refresh 恒优先于伪 span';
    });

    // 测试 5: 纯文本 span 不误报 —— 无特征元素仍走未命中路径
    await runStep("5. [负例] 纯文本 span(无 pointer/onclick/tabindex)不命中", async () => {
      let err: any = null;
      try {
        await fetchJson("/click", { method: "POST", body: JSON.stringify({ what: "纯文本说明" }) });
      } catch (e) {
        err = e;
      }
      if (err === null) throw new Error("纯文本 span 竟然命中并点击了(误报)");
      if (!/语义定位未命中/.test(String(err.message))) throw new Error(`错误语义不符: ${err.message}`);
      return "无特征纯文本 span 正确报「语义定位未命中」,未误点";
    });

    // 测试 6: SoM 标徽包含伪可点击元素 —— 与 what 扫描不分叉
    await runStep("6. [SoM 标徽] som 截图标徽清单包含 cursor:pointer span", async () => {
      const shot = await fetchJson("/screenshot", { method: "POST", body: JSON.stringify({ som: true }) });
      const marks: Array<{ id: number; role: string; name: string }> = shot.somMarks ?? [];
      const names = marks.map((m) => m.name);
      if (!names.includes("返回上一级")) {
        throw new Error(`SoM 标徽缺失伪可点击元素「返回上一级」: ${names.join("; ")}`);
      }
      const pseudo = marks.find((m) => m.name === "返回上一级")!;
      if (pseudo.role !== "clickable") throw new Error(`伪可点击标徽角色应为 clickable,实际 ${pseudo.role}`);
      return `标徽 #${pseudo.id} = ${pseudo.role} "返回上一级"(共 ${marks.length} 个标徽)`;
    });

    console.log("\n======================================================================");
    console.log("🎉 疑似可点击启发式 6 项场景 100% 验证成功！");
    console.log("======================================================================\n");
  } finally {
    try {
      await fetchJson("/close", { method: "POST" }).catch(() => {});
    } catch {
      /* ignore */
    }
    serverProc?.kill("SIGTERM");
    // npx 包装层被 kill 后 tsx 子进程可能残留(孤儿占端口害下次运行"未就绪"),
    // 按命令行特征补杀整个进程树
    spawn("pkill", ["-f", `dev-server.ts ${TARGET_PAGE_URL}`]).on("error", () => {});
  }
}

main().catch((err) => {
  console.error("\n❌ 测试失败:", err.message);
  process.exit(1);
});
