// F4 选择器自愈:降级候选生成 + runReplay 自愈行为 + 录制格式 v2
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { healCandidates, runReplay, replayTool } from "../src/browser/tools.js";
import { loadRecordings, saveRecordingFile, recordingsDir } from "../src/browser/recordings.js";
import { savedRecordings } from "../src/browser/session.js";
import type { SelectorHint } from "../src/browser/types.js";

describe("healCandidates(降级链顺序)", () => {
  const full: SelectorHint = { testid: "login-btn", role: "button", name: "登 录", id: "submit", text: "登 录", tag: "button" };

  it("全指纹:按 testid → role+name → text → id → tag+text 排序", () => {
    const c = healCandidates(full);
    expect(c.map((x) => x.via)).toEqual(["testid", "role+name", "text", "id", "tag+text"]);
    expect(c[0].selector).toBe('css=[data-testid="login-btn"]');
    expect(c[1].selector).toBe('role=button[name="登 录"]');
    expect(c[2].selector).toBe('text="登 录"');
    expect(c[3].selector).toBe('css=[id="submit"]');
    expect(c[4].selector).toBe('css=button:has-text("登 录")');
  });

  it("引号正确转义", () => {
    const c = healCandidates({ role: "button", name: 'say "hi"' });
    expect(c[0].selector).toBe('role=button[name="say \\"hi\\""]');
  });

  it("指纹不全时只生成可用候选", () => {
    expect(healCandidates({})).toEqual([]);
    const c = healCandidates({ text: "确定" });
    expect(c.map((x) => x.via)).toEqual(["text"]);
  });
});

describe("runReplay 自愈行为", () => {
  /** stub:原 selector 失败,role+name 候选成功。 */
  function makeImpls(failSelectors: Set<string>) {
    const calls: string[] = [];
    return {
      calls,
      impls: {
        browser_click: async (args: any) => {
          calls.push(args.selector);
          if (failSelectors.has(args.selector)) throw new Error(`Timeout: ${args.selector}`);
          return { ok: true };
        },
      },
    };
  }
  const bad = "#old-selector";
  const hint: SelectorHint = { role: "button", name: "提交" };
  const steps = [{ tool: "browser_click", args: { selector: bad }, meta: { hint } }];

  it("原选择器失败后按候选自愈并标记 healed", async () => {
    const { calls, impls } = makeImpls(new Set([bad]));
    const r = await runReplay(steps, impls as any, true, { healing: true, healTimeoutMs: 10 });
    expect(r.passed).toBe(1);
    expect(r.healedCount).toBe(1);
    const step = r.results[0];
    expect(step.ok).toBe(true);
    expect(step.healed).toBe(true);
    expect(step.via).toBe("role+name");
    // 调用顺序:原 selector(短超时) → role+name 候选
    expect(calls[0]).toBe(bad);
    expect(calls[1]).toContain("role=button");
  });

  it("healing 关闭时原样失败(错误不含自愈信息)", async () => {
    const { impls } = makeImpls(new Set([bad]));
    const r = await runReplay(steps, impls as any, true, { healing: false });
    expect(r.failed).toBe(1);
    expect(r.healedCount).toBe(0);
    expect(r.results[0].error).not.toContain("自愈");
  });

  it("全部候选失败时报错并附尝试清单", async () => {
    const failAll = new Set([bad, "css=[data-testid=\"login-btn\"]", "role=button[name=\"提交\"]", 'text="提交"', 'css=[id="login-btn"]', 'css=button:has-text("提交")']);
    const { impls } = makeImpls(failAll);
    const richHint: SelectorHint = { testid: "login-btn", role: "button", name: "提交", id: "login-btn", text: "提交", tag: "button" };
    const r = await runReplay(
      [{ tool: "browser_click", args: { selector: bad }, meta: { hint: richHint } }],
      impls as any,
      true,
      { healing: true, healTimeoutMs: 10 },
    );
    expect(r.failed).toBe(1);
    expect(r.healedCount).toBe(0);
    expect(r.results[0].error).toContain("自愈已尝试");
    expect(r.results[0].error).toContain("testid");
  });

  it("无 meta 的步骤不受自愈影响", async () => {
    const { impls } = makeImpls(new Set([bad]));
    const r = await runReplay([{ tool: "browser_click", args: { selector: bad } }], impls as any, true, { healing: true });
    expect(r.failed).toBe(1);
    expect(r.results[0].error).not.toContain("自愈已尝试");
  });
});

describe("录制格式 formatVersion 2(带 meta 持久化)", () => {
  let tmpHome: string;
  const origHome = process.env.DSH_HOME;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "dsh-browser-heal-"));
    process.env.DSH_HOME = tmpHome;
  });
  afterAll(() => {
    if (origHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = origHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("保存的录制文件声明 formatVersion 2 且 meta 往返一致", async () => {
    const steps = [{ tool: "browser_click", args: { selector: "#x" }, meta: { hint: { role: "button", name: "ok" } } }];
    const file = saveRecordingFile("fmt2", steps);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.formatVersion).toBe(2);
    expect(raw.steps[0].meta.hint).toEqual({ role: "button", name: "ok" });
    // 重新加载进内存表,回放可拿到指纹
    savedRecordings.delete("fmt2");
    loadRecordings();
    const loaded = savedRecordings.get("fmt2");
    expect(loaded?.steps[0].meta?.hint).toEqual({ role: "button", name: "ok" });
  });

  it("旧格式(无 formatVersion)录制仍可加载", () => {
    const dir = join(recordingsDir());
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "legacy.json"),
      JSON.stringify({ steps: [{ tool: "browser_click", args: { selector: "#a" } }], savedAt: 1 }),
    );
    savedRecordings.delete("legacy");
    loadRecordings();
    expect(savedRecordings.get("legacy")?.steps).toHaveLength(1);
  });

  it("replay 通过 stepImpls 的录制自带指纹时可自愈", async () => {
    savedRecordings.set("auto-heal", {
      savedAt: Date.now(),
      steps: [{ tool: "browser_click", args: { selector: "#gone" }, meta: { hint: { text: "按钮文字" } } }],
    });
    const calls: string[] = [];
    const impls = {
      browser_click: async (args: any) => {
        calls.push(args.selector);
        if (args.selector === "#gone") throw new Error("timeout");
        return { ok: true };
      },
    };
    const r: any = await replayTool({ name: "auto-heal" }, impls as any, { selectorHealing: true, healTimeoutMs: 10 } as any);
    expect(r.healedCount).toBe(1);
    expect(calls).toContain('text="按钮文字"');
  });
});
