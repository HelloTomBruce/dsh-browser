// 录制保真回归测试:长字段(中文 eval 脚本、batch steps 数组)在
// 录制 → record save → replay 链路上必须原样保留。
// 背景:register 打点层曾把 >300 字符的字段截断成 "…(截断)" 字符串,
// 导致回放 eval 报 Invalid or unexpected token、batch steps 变空/损坏。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordTool, replayTool, runReplay } from "../src/browser/tools.js";
import { savedRecordings, startRecording, stopRecording, recordCall, clearTestLog } from "../src/browser/session.js";

let dir: string;
const origHome = process.env.DSH_HOME;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dsh-browser-fidelity-"));
  process.env.DSH_HOME = dir;
  savedRecordings.clear();
  clearTestLog();
});

afterAll(() => {
  if (origHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("录制保真(大字段不截断)", () => {
  it("recordCall 保存的 args 原样进录制 buffer(中文长脚本、batch steps)", async () => {
    const chineseScript = `// 选择包含"确定"的按钮并滚动到可视区\n// 背景:提交订单弹窗里的确认按钮没有稳定 id,只能按中文文案匹配定位\nconst buttons = Array.from(document.querySelectorAll("button"));\nconst btn = buttons.find(b => (b.innerText || "").includes("确定提交订单"));if (btn) { btn.scrollIntoView({ block: "center", behavior: "smooth" }); btn.style.outline = "2px solid red"; btn.setAttribute("data-dsh-preview", "1"); } return btn ? btn.innerText.trim() : null;`;
    expect(JSON.stringify(chineseScript).length).toBeGreaterThan(300); // 确认覆盖旧截断阈值
    const batchSteps = Array.from({ length: 12 }, (_, i) => ({ tool: "browser_click", args: { selector: `#item-${i}` } }));
    expect(JSON.stringify(batchSteps).length).toBeGreaterThan(300);

    startRecording();
    recordCall({ tool: "browser_eval", args: { script: chineseScript }, ok: true, ms: 1, ts: 1 });
    recordCall({ tool: "browser_batch", args: { steps: batchSteps }, ok: true, ms: 1, ts: 2 });
    stopRecording();

    const saved = (await recordTool({ action: "save", name: "fidelity" })) as Record<string, any>;
    expect(saved.steps).toBe(2);

    const steps = savedRecordings.get("fidelity")!.steps;
    // eval 脚本一字不差(旧 bug:被替换为 "…(截断)" 字符串)
    expect(steps[0].args.script).toBe(chineseScript);
    // batch steps 完整保留为数组(旧 bug:被截断成字符串,回放报"需要非空 steps 数组")
    expect(steps[1].args.steps).toEqual(batchSteps);
    // 任何字段都不含截断标记
    expect(JSON.stringify(steps)).not.toContain("(截断)");
  });

  it("回放收到完整脚本与 steps", async () => {
    const recording = savedRecordings.get("fidelity")!;
    const seen: any[] = [];
    const impls: Record<string, (a: any) => Promise<unknown>> = {
      browser_eval: async (a) => {
        seen.push({ tool: "browser_eval", args: a });
        return {};
      },
      browser_batch: async (a) => {
        seen.push({ tool: "browser_batch", args: a });
        return {};
      },
    };
    const r = await runReplay(recording.steps as any, impls, true);
    expect(r).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(seen[0].args.script).toBe(recording.steps[0].args.script);
    expect(seen[1].args.steps).toHaveLength(12);
  });

  it("replayTool 按名字回放已保存录制(数据来自内存表,不经展示层)", async () => {
    // replayTool 的 impls 由 register 注入;这里直接验证 name 解析出的步骤完整。
    const result = await replayTool({ name: "fidelity" }, {
      browser_eval: async () => ({}),
      browser_batch: async () => ({}),
    }, {});
    expect(result).toMatchObject({ total: 2, passed: 2 });
  });
});
