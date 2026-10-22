// scripts/perf-benchmark.ts
// 针对复杂前端场景 (Vite + Vue + Ant Design Vue) 的全面性能评估与问题探测脚本

import { performance } from "node:perf_hooks";
import { closeBrowser, getPage } from "../src/browser/session.js";
import {
  openTool,
  snapshotTool,
  findTool,
  clickTool,
  typeTool,
  screenshotTool,
  batchTool,
  extractTool,
} from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const config: BrowserConfig = {
  channel: "auto",
  headless: true, // 使用 headless 保证评测标准一致
  timeoutMs: 30000,
};

interface MetricResult {
  step: string;
  durationMs: number;
  details: Record<string, any>;
  issues: string[];
}

const metrics: MetricResult[] = [];

async function measure<T>(
  step: string,
  fn: () => Promise<T>,
  checkIssues?: (res: T, duration: number) => string[],
): Promise<T> {
  const start = performance.now();
  let res: T;
  try {
    res = await fn();
  } catch (err: any) {
    const duration = performance.now() - start;
    metrics.push({
      step,
      durationMs: Number(duration.toFixed(2)),
      details: { error: err.message },
      issues: [`执行抛出异常: ${err.message}`],
    });
    throw err;
  }
  const duration = performance.now() - start;
  const issues = checkIssues ? checkIssues(res, duration) : [];
  metrics.push({
    step,
    durationMs: Number(duration.toFixed(2)),
    details: typeof res === "object" && res !== null ? (res as any) : { value: res },
    issues,
  });
  return res;
}

async function runBenchmark() {
  const targetUrl = process.argv[2] || process.env.URL || "http://127.0.0.1:5173";
  console.log(`\n======================================================================`);
  console.log(`🚀 开始针对 Ant Design Vue 复杂场景的性能与问题诊断`);
  console.log(`🎯 目标 URL: ${targetUrl}`);
  console.log(`======================================================================\n`);

  // 1. 页面打开与首次就绪
  console.log(`▶ [阶段 1] 测量页面加载与就绪时间 (openTool)...`);
  const openRes = await measure(
    "1. 页面导航与加载 (openTool)",
    async () => openTool(config, { url: targetUrl }),
    (res, duration) => {
      const list: string[] = [];
      if (duration > 2000) list.push(`页面导航耗时偏高 (${duration.toFixed(1)}ms)`);
      return list;
    },
  );
  console.log(`   ✓ 页面加载完成: "${openRes.title}" 耗时: ${metrics[metrics.length - 1].durationMs}ms`);

  const page = await getPage(config);

  // 收集 DOM 规模统计
  const domStats = await page.evaluate(`(() => {
    const all = document.querySelectorAll("*");
    let maxDepth = 0;
    function calcDepth(el, depth) {
      if (depth > maxDepth) maxDepth = depth;
      for (const c of Array.from(el.children)) {
        calcDepth(c, depth + 1);
      }
    }
    calcDepth(document.body, 1);
    return {
      totalElements: all.length,
      buttons: document.querySelectorAll("button").length,
      inputs: document.querySelectorAll("input, textarea, select").length,
      maxDomDepth: maxDepth,
    };
  })()`);
  console.log(`   📊 当前首屏 DOM 统计: 总节点数 ${domStats.totalElements}, 最大层深 ${domStats.maxDomDepth}, 按钮 ${domStats.buttons}, 输入控件 ${domStats.inputs}`);

  // 2. ARIA 快照评估
  console.log(`\n▶ [阶段 2] 测量 ARIA 树遍历与快照效率 (snapshotTool - aria 模式)...`);
  const ariaSnap1 = await measure(
    "2. ARIA 树遍历与快照 (首屏 Tab 1)",
    async () => snapshotTool(config, { mode: "aria", maxRefs: 200 }),
    (res: any, duration) => {
      const list: string[] = [];
      if (duration > 300) list.push(`快照生成耗时显著 (${duration.toFixed(1)}ms)`);
      if (res.truncated) list.push(`ARIA 树发生截断 (truncated: true)，部分底层组件可能无法被文本模型感知！`);
      if (res.refs === 0) list.push(`未分配任何有效 ref！`);
      return list;
    },
  );
  console.log(`   ✓ ARIA 快照耗时: ${metrics[metrics.length - 1].durationMs}ms, 生成 ref 数: ${ariaSnap1.refs}, 截断状态: ${ariaSnap1.truncated}`);
  console.log(`   ℹ 预览前 300 字符:\n${(ariaSnap1.tree || "").slice(0, 300)}...\n`);

  // 3. 语义查找性能与命中度评估 (针对 Ant Design Vue 常见嵌套控件)
  console.log(`▶ [阶段 3] 测量语义查找效率与各种组件的命中情况 (semanticFind)...`);
  const queries = [
    { label: "简单标准按钮", q: "立即保存配置", exact: true },
    { label: "带图标/嵌套按钮", q: "打开高级参数 Modal", exact: false },
    { label: "表单输入框", q: "集群名称", exact: false },
    { label: "单选 Radio 项", q: "Round-Robin", exact: false },
    { label: "穿梭框按钮或条目", q: "权限策略策略集_1", exact: false },
    { label: "不存在的幽灵元素", q: "NonExistentElement-XYZ", exact: false },
  ];

  for (const { label, q, exact } of queries) {
    await measure(
      `3. 语义查找: ${label} ("${q}")`,
      async () => findTool(config, { query: q, exact }),
      (res: any, duration) => {
        const list: string[] = [];
        if (duration > 150) list.push(`语义查找耗时过长 (${duration.toFixed(1)}ms)`);
        if (q !== "NonExistentElement-XYZ" && res.found === 0) {
          list.push(`未定位到元素 "${q}" (扫描了 ${res.scanned} 个交互节点)`);
        }
        return list;
      },
    );
  }

  // 4. 表单交互与动态 DOM 反馈
  console.log(`\n▶ [阶段 4] 测量交互操作响应 (输入、点击、弹窗呼出)...`);
  await measure(
    "4.1 输入操作: 集群名称输入框",
    async () => typeTool(config, { selector: "input[placeholder*='k8s-prod']", text: "benchmark-cluster-test-99" }),
  );

  await measure(
    "4.2 点击呼出 Modal 弹窗",
    async () => clickTool(config, { selector: "text=打开高级参数 Modal" }),
    (res, duration) => {
      const list: string[] = [];
      if (duration > 500) list.push(`点击与等待响应较慢 (${duration.toFixed(1)}ms)`);
      return list;
    },
  );

  // 弹窗打开后再次快照评估 (浮层与遮罩对快照的干扰)
  await measure(
    "4.3 Modal 打开状态下的 ARIA 快照",
    async () => snapshotTool(config, { mode: "aria", maxRefs: 200 }),
    (res: any) => {
      const list: string[] = [];
      // 检查 Modal 内容是否被截断或淹没
      if (!res.tree?.includes("高级运行时参数微调")) {
        list.push(`Modal 弹窗标题未在 ARIA 树中体现，浮层元素可能由于 DOM 挂载在 body 底部或层深超限被漏掉！`);
      }
      return list;
    },
  );

  // 关闭 Modal (通过点击确定按钮关闭)
  await measure(
    "4.4 点击关闭 Modal",
    async () => clickTool(config, { selector: ".ant-modal-footer .ant-btn-primary" }),
  );
  await new Promise((r) => setTimeout(r, 500)); // 等待 Antd 弹窗淡出与动画结束

  // 5. 切换到 Tab 2: 复杂海量数据表格与极限 DOM 压力测试
  console.log(`\n▶ [阶段 5] 切换到 Tab 2 (复杂高密度表格) 并进行海量 DOM 压力测试...`);
  await measure(
    "5.1 切换到 Tab 2 (海量数据表格)",
    async () => clickTool(config, { selector: "text=海量数据表格与复杂操作" }),
  );
  await new Promise((r) => setTimeout(r, 500)); // Vue 渲染缓冲

  const tab2Stats = await page.evaluate(`(() => {
    return {
      totalElements: document.querySelectorAll("*").length,
      tableRows: document.querySelectorAll(".ant-table-row").length,
      tableCells: document.querySelectorAll(".ant-table-cell").length,
    };
  })()`);
  console.log(`   📊 Tab 2 激活后 DOM 统计: 总节点数 ${tab2Stats.totalElements}, 表格行 ${tab2Stats.tableRows}, 表格单元格 ${tab2Stats.tableCells}`);

  // 在大 DOM 下多次测试 ARIA 快照与查找性能
  const snapTab2 = await measure(
    "5.2 Tab 2 大规模 DOM 下的 ARIA 快照",
    async () => snapshotTool(config, { mode: "aria", maxRefs: 300 }),
    (res: any, duration) => {
      const list: string[] = [];
      if (duration > 300) list.push(`大规模 DOM 下快照耗时激增至 ${duration.toFixed(1)}ms`);
      if (res.truncated) list.push(`表格场景下 ARIA 快照必然触达行数/层深上限触发截断！`);
      return list;
    },
  );
  console.log(`   ✓ Tab 2 快照耗时: ${metrics[metrics.length - 1].durationMs}ms, 截断: ${snapTab2.truncated}`);

  // 在海量表格中搜索特定单元格与操作
  await measure(
    "5.3 大表格场景语义查找 (第 15 个任务)",
    async () => findTool(config, { query: "TASK-1014", exact: false }),
  );

  // 测试数据抽取 extractTool 性能
  console.log(`\n▶ [阶段 6] 测试结构化抽取与推断 (extractTool)...`);
  await measure(
    "6.1 字段自动推断 suggest (extractTool)",
    async () => extractTool(config, { action: "suggest", scope: ".ant-table" }),
  );

  await measure(
    "6.2 表格数据抽取 (extractTool - 指定 fields 规范)",
    async () =>
      extractTool(config, {
        fields: [
          {
            name: "tasks",
            selector: ".ant-table-tbody tr.ant-table-row",
            multiple: true,
            fields: [
              { name: "taskId", selector: "td:nth-child(2)" },
              { name: "taskName", selector: "td:nth-child(3)" },
              { name: "operator", selector: "td:nth-child(4)" },
            ],
          },
        ],
      }),
  );

  // 7. 截图性能测试
  console.log(`\n▶ [阶段 7] 测量截图性能 (普通视口 vs 全页面截图)...`);
  await measure(
    "7.1 视口截图 (screenshotTool)",
    async () => screenshotTool(config, { name: "bench-viewport.png", fullPage: false }),
  );

  await measure(
    "7.2 全页面截图 (fullPage: true)",
    async () => screenshotTool(config, { name: "bench-fullpage.png", fullPage: true }),
    (res, duration) => {
      const list: string[] = [];
      if (duration > 1000) list.push(`全长截图耗时过高 (${duration.toFixed(1)}ms)`);
      return list;
    },
  );

  // 8. 测量连续批量调用 (batchTool)
  console.log(`\n▶ [阶段 8] 测量批处理 (batchTool) 组合调用...`);
  const stepImpls: Record<string, (args: any) => Promise<unknown>> = {
    browser_snapshot: (a) => snapshotTool(config, a),
    browser_click: (a) => clickTool(config, a),
    browser_screenshot: (a) => screenshotTool(config, a),
  };
  await measure(
    "8. 批处理 4 个顺序指令 (batchTool)",
    async () =>
      batchTool(
        {
          steps: [
            { tool: "browser_snapshot", args: { mode: "aria", maxRefs: 50 } },
            { tool: "browser_click", args: { selector: "text=组织架构树与级联信息" } },
            { tool: "browser_snapshot", args: { mode: "aria", maxRefs: 50 } },
            { tool: "browser_screenshot", args: { name: "bench-batch.png" } },
          ],
        },
        stepImpls,
        config,
      ),
  );

  console.log(`\n🏁 测试执行完毕，正在关闭浏览器...`);
  await closeBrowser();

  // 汇总报告输出
  console.log(`\n======================================================================`);
  console.log(`📊 性能度量与诊断汇总报告`);
  console.log(`======================================================================`);
  console.table(
    metrics.map((m) => ({
      步骤: m.step,
      "耗时 (ms)": m.durationMs,
      发现问题: m.issues.length > 0 ? `⚠️ ${m.issues.join("; ")}` : "✅ 正常",
    })),
  );

  const totalTime = metrics.reduce((acc, cur) => acc + cur.durationMs, 0);
  console.log(`\n⏱️ 总执行时间: ${totalTime.toFixed(2)}ms`);

  const allIssues = metrics.filter((m) => m.issues.length > 0);
  console.log(`\n🚨 发现的问题与隐患共计 ${allIssues.length} 项:`);
  for (const item of allIssues) {
    console.log(`  - [${item.step}]:`);
    for (const issue of item.issues) {
      console.log(`      * ${issue}`);
    }
  }
}

runBenchmark().catch((err) => {
  console.error("Benchmark 运行异常:", err);
  closeBrowser().finally(() => process.exit(1));
});
