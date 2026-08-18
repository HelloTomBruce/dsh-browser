import { describe, it, expect } from "vitest";
import { resolveConfig, validateConfig, type ConfigSchema } from "../src/lib/config.js";

const SCHEMA: ConfigSchema = {
  enabled: { type: "boolean", optional: true },
  channel: { type: "string", enum: ["auto", "msedge", "chrome", "chromium"] },
  headless: { type: "boolean", optional: true },
  timeoutMs: { type: "number", min: 1, max: 60000, optional: true },
  screenshotMaxCount: { type: "number", min: 0, optional: true },
  profiles: { type: "any", optional: true },
};

describe("resolveConfig", () => {
  it("合并默认值与传入配置", () => {
    const config = resolveConfig("browser", SCHEMA, {
      channel: "auto",
      headless: true,
      timeoutMs: 30000,
    }, { headless: false, timeoutMs: 5000 });
    expect(config.channel).toBe("auto");
    expect(config.headless).toBe(false);
    expect(config.timeoutMs).toBe(5000);
  });

  it("非法枚举值报错并带模块名", () => {
    expect(() =>
      resolveConfig("browser", SCHEMA, { channel: "auto", headless: true }, { channel: "firefox" }),
    ).toThrow(/dsh-browser/);
  });

  it("超出数字范围报错", () => {
    expect(() =>
      resolveConfig("browser", SCHEMA, { channel: "auto", headless: true }, { timeoutMs: 0 }),
    ).toThrow(/timeoutMs/);
  });

  it("optional 字段可缺失", () => {
    const errors = validateConfig(SCHEMA, { channel: "auto", headless: true });
    expect(errors).toEqual([]);
  });
});
