// test/codegen-playwright.test.ts
// 原生 Playwright Spec 代码生成器测试
import { describe, expect, it } from "vitest";
import { compileToPlaywrightSpec } from "../src/browser/codegen/playwright.js";
import type { ReplayStep } from "../src/browser/types.js";

describe("Playwright Spec 编译器 (compileToPlaywrightSpec)", () => {
  it("转译基础交互序列为标准 Playwright 代码", () => {
    const steps: ReplayStep[] = [
      { tool: "browser_open", args: { url: "https://example.com/login" } },
      { tool: "browser_type", args: { selector: "#user", text: "admin" } },
      { tool: "browser_type", args: { selector: "#pwd", text: "123456" } },
      { tool: "browser_click", args: { selector: "#login-btn" } },
      { tool: "browser_wait_for", args: { url: "https://example.com/dashboard" } },
      { tool: "browser_assert", args: { selector: "h1", text: "欢迎控制台" } },
    ];

    const code = compileToPlaywrightSpec(steps, { title: "登录自动化回归" });

    expect(code).toContain('import { test, expect } from "@playwright/test";');
    expect(code).toContain('test.describe("登录自动化回归", () => {');
    expect(code).toContain("await page.goto(\"https://example.com/login\");");
    expect(code).toContain('await page.locator("#user").fill("admin");');
    expect(code).toContain('await page.locator("#pwd").fill("123456");');
    expect(code).toContain('await page.locator("#login-btn").click();');
    expect(code).toContain('await page.waitForURL("https://example.com/dashboard");');
    expect(code).toContain('await expect(page.locator("h1")).toContainText("欢迎控制台");');
  });

  it("支持表单批量填充原语转译", () => {
    const steps: ReplayStep[] = [
      {
        tool: "browser_form_fill",
        args: {
          fields: { 用户名: "张三", 部门: "财务部" },
          submitButton: "保存",
        },
      },
    ];

    const code = compileToPlaywrightSpec(steps);
    expect(code).toContain('await page.getByLabel("用户名").fill("张三")');
    expect(code).toContain('await page.getByLabel("部门").fill("财务部")');
    expect(code).toContain('await page.getByRole("button", { name: "保存" }).click()');
  });
});
