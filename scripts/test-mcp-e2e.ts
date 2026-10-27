// scripts/test-mcp-e2e.ts
// MCP server 全链路 e2e:spawn 构建产物 lib/mcp.js,走真实 stdio JSON-RPC——
// initialize → tools/list → browser_open(file:// 裸静态页) → browser_snapshot
// → SIGTERM 干净退出。自包含:不需要 DSH 宿主与外部服务。
// 前置:pnpm build(直接驱动 bin 产物,顺带验证 shebang/外置依赖/包版本解析)。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const MCP_ENTRY = join(repoRoot, "lib", "mcp.js");
const TARGET_PAGE_URL = `file://${join(repoRoot, "playground", "shadow-dom.html")}`;

/** 极简 MCP stdio 客户端:换行分隔 JSON-RPC,只做本测试需要的请求/通知。 */
class McpStdioClient {
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private readonly stderrChunks: string[] = [];
  readonly proc: ChildProcess;
  exitCode: number | null = null;

  constructor(env: NodeJS.ProcessEnv) {
    this.proc = spawn(process.execPath, [MCP_ENTRY], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr!.setEncoding("utf8");
    this.proc.stderr!.on("data", (chunk: string) => this.stderrChunks.push(chunk));
    this.proc.on("exit", (code) => {
      this.exitCode = code;
      for (const { reject } of this.pending.values()) reject(new Error("MCP server 进程提前退出"));
      this.pending.clear();
    });
  }

  get stderrText(): string {
    return this.stderrChunks.join("");
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length === 0) continue;
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
      // 通知/服务端请求忽略(本测试不触发)
    }
  }

  request(method: string, params: unknown, timeoutMs = 60_000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 超时(${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.proc.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async waitForExit(timeoutMs = 15_000): Promise<number | null> {
    if (this.exitCode !== null) return this.exitCode;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待进程退出超时")), timeoutMs);
      this.proc.once("exit", (code) => {
        clearTimeout(timer);
        this.exitCode = code;
        resolve(code);
      });
    });
  }
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
  if (!existsSync(MCP_ENTRY)) {
    throw new Error("lib/mcp.js 不存在——先跑 pnpm build(本测试直接驱动构建产物)");
  }
  const isHeadless = process.env.HEADLESS !== "false"; // 默认无头,HEADLESS=false 弹窗观察
  const dshHome = mkdtempSync(join(tmpdir(), "dsh-browser-mcp-e2e-"));
  console.log("======================================================================");
  console.log(`🚀 MCP server 全链路 e2e (Headless: ${isHeadless})`);
  console.log(`🔌 目标: node lib/mcp.js (stdio)`);
  console.log(`🌐 测试页: ${TARGET_PAGE_URL}`);
  console.log("======================================================================\n");

  const client = new McpStdioClient({
    ...process.env,
    DSH_HOME: dshHome,
    DSH_BROWSER_HEADLESS: isHeadless ? "true" : "false",
    DSH_BROWSER_USER_DATA_DIR: "",
  });

  try {
    let tools: any[] = [];
    await runStep("initialize 握手(instructions 与 DSH systemPrompt 同源)", async () => {
      const result = await client.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mcp-e2e", version: "0.0.0" },
      });
      if (result.serverInfo?.name !== "dsh-browser-view") {
        throw new Error(`serverInfo.name = ${result.serverInfo?.name}`);
      }
      if (typeof result.instructions !== "string" || !result.instructions.includes("意图语义定位")) {
        throw new Error("instructions 缺失或不含工具指引");
      }
      client.notify("notifications/initialized");
      return `server: ${result.serverInfo.name}@${result.serverInfo.version}, instructions ${result.instructions.length} 字`;
    });

    await runStep("tools/list 返回全部 38 个工具", async () => {
      const result = await client.request("tools/list", {});
      tools = result.tools ?? [];
      if (tools.length !== 38) throw new Error(`工具数 ${tools.length} ≠ 38`);
      const badSchema = tools.filter((t) => t.inputSchema?.type !== "object").length;
      if (badSchema > 0) throw new Error(`${badSchema} 个工具 inputSchema 形状异常`);
      return `38 个工具,inputSchema/outputSchema 全部就位`;
    });

    await runStep("tools/call browser_open(真实浏览器打开 file:// 静态页)", async () => {
      const result = await client.request("tools/call", {
        name: "browser_open",
        arguments: { url: TARGET_PAGE_URL },
      });
      if (result.isError) throw new Error(result.content?.[0]?.text ?? "browser_open 失败");
      const text = result.content?.[0]?.text ?? "";
      if (!/shadow-dom\.html/.test(text)) throw new Error(`返回未含目标 URL: ${text.slice(0, 120)}`);
      return `已打开: ${text.replace(/\s+/g, " ").slice(0, 100)}`;
    });

    await runStep("tools/call browser_snapshot(aria 模式 Shadow 穿透快照)", async () => {
      const result = await client.request("tools/call", {
        name: "browser_snapshot",
        arguments: { mode: "aria" },
      });
      if (result.isError) throw new Error(result.content?.[0]?.text ?? "browser_snapshot 失败");
      const text = result.content?.[0]?.text ?? "";
      if (!text.includes("Shadow 提交")) throw new Error(`快照文本未含「Shadow 提交」: ${text.slice(0, 160)}`);
      return `快照 ${text.length} 字,含 shadow 内按钮文本「Shadow 提交」`;
    });

    await runStep("tools/call browser_status(structuredContent 通道)", async () => {
      const result = await client.request("tools/call", { name: "browser_status", arguments: {} });
      if (result.isError) throw new Error("browser_status 失败");
      if (result.structuredContent?.open !== true) {
        throw new Error(`structuredContent.open = ${result.structuredContent?.open}`);
      }
      return `open=true, tabs=${result.structuredContent.tabs ?? "?"}`;
    });

    await runStep("SIGTERM → closeBrowser 清理 → 干净退出(exit 0)", async () => {
      client.proc.kill("SIGTERM");
      const code = await client.waitForExit();
      if (code !== 0) throw new Error(`退出码 ${code}(期望 0)`);
      if (!client.stderrText.includes("已退出")) throw new Error("stderr 未含清理日志");
      return "退出码 0,浏览器会话已清理";
    });

    console.log("\n🎉 MCP e2e 全部通过(5 项)\n");
  } finally {
    if (client.exitCode === null) client.proc.kill("SIGKILL");
    rmSync(dshHome, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n💥 MCP e2e 失败: ${err.message}\n`);
  process.exit(1);
});
