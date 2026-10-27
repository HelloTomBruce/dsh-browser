// dsh-browser · MCP 环境变量配置解析单测
//
// 独立 MCP 入口不读 cordis.patch.yml:DSH_BROWSER_<大写蛇形> → camelCase,
// 值按目标键 SCHEMA 类型解析后过同一 resolveConfig(校验/默认值全复用)。

import { describe, expect, it } from "vitest";
import { configFromEnv } from "../src/mcp.js";
import { resolveConfig } from "../src/lib/config.js";
import { BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG } from "../src/lib/schema.js";

describe("configFromEnv", () => {
  it("空环境返回空对象(全走默认值)", () => {
    expect(configFromEnv({})).toEqual({});
    expect(configFromEnv({ PATH: "/bin", DSH_HOME: "/tmp/x" })).toEqual({});
  });

  it("基础类型:boolean / number / string 按 SCHEMA 类型解析", () => {
    const raw = configFromEnv({
      DSH_BROWSER_HEADLESS: "true",
      DSH_BROWSER_TIMEOUT_MS: "5000",
      DSH_BROWSER_TOOLSET: "core",
      DSH_BROWSER_USER_DATA_DIR: "/tmp/mcp-profile",
    });
    expect(raw).toEqual({
      headless: true,
      timeoutMs: 5000,
      toolset: "core",
      userDataDir: "/tmp/mcp-profile",
    });
  });

  it("boolean 只认 true,其余为 false;数字键非数字值变 NaN 交给 resolveConfig 报错", () => {
    const raw = configFromEnv({ DSH_BROWSER_HEADLESS: "false", DSH_BROWSER_ENABLED: "yes" });
    expect(raw.headless).toBe(false);
    expect(raw.enabled).toBe(false);
    expect(configFromEnv({ DSH_BROWSER_MAX_LINKS: "abc" }).maxLinks).toBeNaN();
  });

  it("string[] 键逗号分隔(去空白/去空项)", () => {
    expect(configFromEnv({ DSH_BROWSER_SENSITIVE_PATTERNS: "提交, 删除 ,支付," })).toEqual({
      sensitivePatterns: ["提交", "删除", "支付"],
    });
  });

  it("any/object 键尝试 JSON.parse,失败回退原字符串", () => {
    expect(configFromEnv({ DSH_BROWSER_HUMANIZE: '"auto"' })).toEqual({ humanize: "auto" });
    expect(configFromEnv({ DSH_BROWSER_PROFILES: '{"work":{}}' })).toEqual({ profiles: { work: {} } });
    expect(configFromEnv({ DSH_BROWSER_HUMANIZE: "auto" })).toEqual({ humanize: "auto" });
  });

  it("多词键转 camelCase;未声明键原样透传;空值忽略", () => {
    expect(configFromEnv({ DSH_BROWSER_EXECUTABLE_PATH: "/usr/bin/chromium" })).toEqual({
      executablePath: "/usr/bin/chromium",
    });
    expect(configFromEnv({ DSH_BROWSER_SCREENSHOT_MAX_AGE_DAYS: "3" })).toEqual({
      screenshotMaxAgeDays: 3,
    });
    // 未在 SCHEMA 声明的键:resolveConfig 对 schema 外键不报错,原样透传
    expect(configFromEnv({ DSH_BROWSER_CUSTOM_FLAG: "x" })).toEqual({ customFlag: "x" });
    expect(configFromEnv({ DSH_BROWSER_TOOLSET: "" })).toEqual({});
  });

  it("与 resolveConfig 集成:非法枚举报错且含模块名", () => {
    const raw = configFromEnv({ DSH_BROWSER_TOOLSET: "both" });
    expect(() => resolveConfig("dsh-browser-mcp", BROWSER_CONFIG_SCHEMA, BROWSER_DEFAULT_CONFIG, raw)).toThrow(
      /dsh-browser-mcp.*toolset/s,
    );
  });

  it("与 resolveConfig 集成:env 值正确合并默认值", () => {
    const resolved = resolveConfig(
      "dsh-browser-mcp",
      BROWSER_CONFIG_SCHEMA,
      BROWSER_DEFAULT_CONFIG,
      configFromEnv({ DSH_BROWSER_HEADLESS: "true", DSH_BROWSER_TOOLSET: "core" }),
    );
    expect(resolved.headless).toBe(true);
    expect(resolved.toolset).toBe("core");
    expect(resolved.timeoutMs).toBe(30000);
    expect(resolved.somFallback).toBe(true);
  });
});
