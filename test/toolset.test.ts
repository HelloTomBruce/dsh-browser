// toolset: core | all 渐进式工具披露测试:
// core 模式只注册高频核心集(低频工具不注册、不进 systemPrompt),
// all(默认)模式与现状零差异(全部 36 个)。
import { describe, it, expect } from "vitest";
import { registerTools } from "../src/browser/register.js";
import type { BrowserConfig } from "../src/browser/types.js";
import type { PlainToolDefinition } from "../src/lib/types.js";

function captureTools(config: BrowserConfig): Map<string, PlainToolDefinition> {
  const defs: PlainToolDefinition[] = [];
  const ctx = {
    get(name: string) {
      if (name === "tools") return { register: (d: PlainToolDefinition) => defs.push(d) };
      return undefined;
    },
    effect: () => {},
  };
  registerTools(ctx as any, config);
  return new Map(defs.map((d) => [d.name, d]));
}

const BASE: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

describe("toolset 披露", () => {
  it("默认(不配置)= all:注册全部 36 个,与现状零差异", () => {
    const tools = captureTools({ ...BASE });
    expect(tools.size).toBe(36);
    expect(tools.has("browser_record")).toBe(true);
    expect(tools.has("browser_replay")).toBe(true);
  });

  it('toolset: "all" 显式配置同样全量', () => {
    const tools = captureTools({ ...BASE, toolset: "all" });
    expect(tools.size).toBe(36);
  });

  it('toolset: "core":只注册核心集,低频工具不注册', () => {
    const tools = captureTools({ ...BASE, toolset: "core" });
    // 核心集都在
    for (const name of [
      "browser_open", "browser_snapshot", "browser_find", "browser_elements",
      "browser_click", "browser_type", "browser_press", "browser_select",
      "browser_eval", "browser_batch", "browser_wait", "browser_wait_for",
      "browser_assert", "browser_screenshot", "browser_wait_for_login",
      "browser_pause_for_human", "browser_confirm", "browser_network",
      "browser_tabs", "browser_download", "browser_upload", "browser_status",
      "browser_doctor", "browser_close",
    ]) {
      expect(tools.has(name), `${name} 应在 core 集`).toBe(true);
    }
    // 低频集不注册(不进 systemPrompt)
    for (const name of [
      "browser_record", "browser_replay", "browser_report",
      "browser_form", "browser_form_save", "browser_forms",
      "browser_extract", "browser_profile", "browser_context",
      "browser_cookies", "browser_back", "browser_reload",
    ]) {
      expect(tools.has(name), `${name} 不应在 core 集`).toBe(false);
    }
    expect(tools.size).toBe(24);
  });
});
