// dsh-browser · 等待人工登录与接管脚本
import { closeBrowser, getPage } from "../src/browser/session.js";
import { openTool, screenshotTool, snapshotTool } from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  channel: "auto",
  headless: false,
  timeoutMs: 60000,
};

async function main() {
  const url = process.argv[2] || process.env.URL || "http://127.0.0.1:7001";
  console.log(`🌐 正在打开登录页: ${url}`);
  await openTool(config, { url });

  const page = await getPage(config);
  const startUrl = page.url();

  console.log("⏳ 等待用户完成登录操作...");
  const startTime = Date.now();
  while (Date.now() - startTime < 180_000) {
    await new Promise((r) => setTimeout(r, 1500));
    if (page.url() !== startUrl && !page.url().includes("login")) {
      console.log(`🎉 检测到登录成功！当前 URL: ${page.url()}`);
      break;
    }
  }

  const shot = await screenshotTool(config, { name: "logged-in.png" });
  console.log(`📸 登录后画面已截图: ${shot.path}`);
  await closeBrowser();
}

main().catch(console.error);
