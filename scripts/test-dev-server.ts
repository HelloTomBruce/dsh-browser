// scripts/test-dev-server.ts
// 针对 dev-server 控制器端点 (HTTP 9527) 测试复杂的 Ant Design Vue 场景

import { performance } from "node:perf_hooks";

const BASE_URL = "http://127.0.0.1:9527";

interface TestStepResult {
  step: string;
  endpoint: string;
  durationMs: number;
  status: number;
  ok: boolean;
  issues: string[];
  summary: string;
}

const results: TestStepResult[] = [];

async function callApi(
  step: string,
  endpoint: string,
  method: "GET" | "POST" = "POST",
  body?: any,
  check?: (data: any) => string[],
): Promise<any> {
  const t0 = performance.now();
  let status = 0;
  let ok = false;
  let data: any = null;
  let issues: string[] = [];

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    ok = res.ok;
    data = await res.json();
  } catch (err: any) {
    const durationMs = Number((performance.now() - t0).toFixed(2));
    results.push({
      step,
      endpoint,
      durationMs,
      status: 0,
      ok: false,
      issues: [`网络请求异常: ${err.message}`],
      summary: `Fetch 失败: ${err.message}`,
    });
    return null;
  }

  const durationMs = Number((performance.now() - t0).toFixed(2));
  if (!ok) {
    issues.push(`HTTP 状态码异常: ${status}, 错误信息: ${data?.error || JSON.stringify(data)}`);
  } else if (check) {
    issues.push(...check(data));
  }

  let summary = "";
  if (data?.title) summary = `Title: "${data.title}"`;
  else if (data?.tree) summary = `Tree chars: ${data.tree.length}, refs: ${data.refs ?? "N/A"}`;
  else if (data?.found !== undefined) summary = `Found: ${data.found}, scanned: ${data.scanned}`;
  else if (data?.clicked) summary = `Clicked: ${data.clicked}`;
  else if (data?.typed) summary = `Typed: ${data.typed}`;
  else if (data?.path) summary = `Screenshot: ${data.path}`;
  else if (data?.metrics) summary = `Scroll top: ${data.metrics.scrollTop}/${data.metrics.scrollHeight}`;
  else if (data?.result) summary = `Eval result: ${JSON.stringify(data.result).slice(0, 50)}`;
  else summary = JSON.stringify(data).slice(0, 60);

  results.push({
    step,
    endpoint,
    durationMs,
    status,
    ok: issues.length === 0,
    issues,
    summary,
  });

  return data;
}

async function runDevServerTest() {
  console.log("======================================================================");
  console.log("🚀 开始通过 dev-server (HTTP 9527) 测试 Ant Design Vue 复杂页面");
  console.log("======================================================================\n");

  // 1. 获取状态
  console.log("▶ [步骤 1] 检查 dev-server 当前页面状态 (/status)...");
  await callApi("1. 查询状态", "/status", "GET", undefined, (d) => {
    const errs: string[] = [];
    if (!d.url?.includes("5173")) errs.push(`当前页面 URL 非 5173: ${d.url}`);
    return errs;
  });

  // 2. 获取全量 ARIA 快照
  console.log("▶ [步骤 2] 获取首屏 ARIA 结构快照 (/snapshot)...");
  const snap1 = await callApi("2. 首屏 ARIA 快照", "/snapshot", "POST", { mode: "aria", maxRefs: 200 }, (d) => {
    const errs: string[] = [];
    if (!d.tree) errs.push("未返回 tree 结构");
    if (!d.tree?.includes("复杂表单与控制中心")) errs.push("快照中未找到首屏主 Tab 文本");
    return errs;
  });

  // 3. 语义查找元素
  console.log("▶ [步骤 3] 语义查找元素 (/find)...");
  await callApi("3.1 查找保存按钮", "/find", "POST", { query: "立即保存配置", exact: true }, (d) => {
    return d.found === 0 ? ["未找到'立即保存配置'按钮"] : [];
  });

  await callApi("3.2 查找集群输入框", "/find", "POST", { query: "集群名称", exact: false }, (d) => {
    return d.found === 0 ? ["未找到'集群名称'输入项"] : [];
  });

  await callApi("3.3 查找单选框 Round-Robin", "/find", "POST", { query: "Round-Robin", exact: false }, (d) => {
    return d.found === 0 ? ["未找到'Round-Robin'单选框"] : [];
  });

  // 4. 输入交互测试
  console.log("▶ [步骤 4] 表单输入测试 (/type)...");
  await callApi(
    "4. 集群名称输入",
    "/type",
    "POST",
    { selector: "input[placeholder*='k8s-prod']", text: "dev-server-cluster-alpha" },
    (d) => (!d.typed ? ["输入操作未成功执行"] : []),
  );

  // 5. 点击呼出 Modal 弹窗
  console.log("▶ [步骤 5] 点击呼出 Modal 弹窗 (/click)...");
  await callApi("5.1 打开 Modal 弹窗", "/click", "POST", { selector: "text=打开高级参数 Modal" });

  // 5.2 弹窗存在时的快照
  await callApi("5.2 弹窗打开时的快照", "/snapshot", "POST", { mode: "aria", maxRefs: 100 }, (d) => {
    return !d.tree?.includes("高级运行时参数微调") ? ["Modal 弹窗未在快照中反映"] : [];
  });

  // 5.3 关闭 Modal 弹窗
  await callApi("5.3 点击确定关闭 Modal", "/click", "POST", { selector: ".ant-modal-footer .ant-btn-primary" });

  // 6. 切换到 Tab 2 (复杂大数据表格)
  console.log("▶ [步骤 6] 切换到 Tab 2 海量数据表格并评估 (/click, /snapshot)...");
  await callApi("6.1 切换到 Tab 2", "/click", "POST", { selector: "text=海量数据表格与复杂操作" });

  // 6.2 大表格快照
  await callApi("6.2 Tab 2 大表格快照", "/snapshot", "POST", { mode: "aria", maxRefs: 300 }, (d) => {
    return !d.tree?.includes("TASK-1000") ? ["表格首行 TASK-1000 未在快照中体现"] : [];
  });

  // 7. 页面容器滚动测试 (/scroll)
  console.log("▶ [步骤 7] 测试滚动能力 (/scroll)...");
  await callApi("7.1 滚动大表格内容", "/scroll", "POST", { selector: ".ant-table-body", deltaY: 300 }, (d) => {
    return !d.ok ? ["滚动执行失败"] : [];
  });

  await callApi("7.2 全局页面滚动", "/scroll", "POST", { deltaY: 400 });

  // 8. 页内 JS 执行 (/eval)
  console.log("▶ [步骤 8] 测试动态 JS 诊断执行 (/eval)...");
  await callApi(
    "8. Eval 统计页面节点与性能",
    "/eval",
    "POST",
    {
      script: `(() => {
        return {
          totalElements: document.querySelectorAll('*').length,
          visibleRows: document.querySelectorAll('.ant-table-row').length,
          heapSize: (performance.memory ? performance.memory.usedJSHeapSize : 'N/A')
        };
      })()`,
    },
    (d) => (d.result?.totalElements === undefined ? ["未能获取页面节点数"] : []),
  );

  // 9. 截图生成 (/screenshot)
  console.log("▶ [步骤 9] 测试截图服务 (/screenshot)...");
  await callApi("9. 生成页面截图", "/screenshot", "POST", { name: "dev-server-test.png" }, (d) => {
    return !d.path ? ["未返回截图路径"] : [];
  });

  // 输出完整汇总报告
  console.log("\n======================================================================");
  console.log("📊 dev-server (HTTP 控制器) 测试报告与执行效率统计");
  console.log("======================================================================");

  console.table(
    results.map((r) => ({
      测试步骤: r.step,
      端点: r.endpoint,
      "耗时 (ms)": r.durationMs,
      HTTP状态: r.status,
      执行结果: r.ok ? "✅ 成功" : `⚠️ 异常 (${r.issues.join("; ")})`,
      摘要信息: r.summary,
    })),
  );

  const totalTime = results.reduce((acc, cur) => acc + cur.durationMs, 0);
  console.log(`\n⏱️ HTTP 全链路总耗时: ${totalTime.toFixed(2)}ms`);

  const failList = results.filter((r) => !r.ok);
  if (failList.length > 0) {
    console.log(`\n🚨 发现的问题与隐患共计 ${failList.length} 项:`);
    for (const f of failList) {
      console.log(`  - [${f.step}] ${f.endpoint}: ${f.issues.join("; ")}`);
    }
  } else {
    console.log("\n🎉 所有 dev-server 控制器端点测试全部通过，执行效率与稳定性良好！");
  }
}

runDevServerTest().catch(console.error);
