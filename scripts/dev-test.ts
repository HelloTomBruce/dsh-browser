// dsh-browser · 本地开发快速测试脚本
import { closeBrowser } from "../src/browser/session.js";
import { openTool, screenshotTool, snapshotTool } from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  channel: "auto",
  headless: false,
  timeoutMs: 30000,
};

async function main() {
  const url = process.argv[2] || process.env.URL || "http://127.0.0.1:7001";
  console.log(`🌐 正在打开页面: ${url}`);
  const res = await openTool(config, { url });
  console.log(`✅ 页面加载成功: "${res.title}" (${res.url})`);

  const snap = await snapshotTool(config, { mode: "aria", maxDepth: 3 });
  console.log("\n📋 ARIA 结构预览:\n", snap.aria?.slice(0, 500) || "(空)");

  const shot = await screenshotTool(config, { name: "dev-test.png" });
  console.log(`\n📸 截图已保存至: ${shot.path}`);

  await new Promise((r) => setTimeout(r, 3000));
  await closeBrowser();
}

main().catch(console.error);
