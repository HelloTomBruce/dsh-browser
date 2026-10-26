// dsh-browser · 原生 Playwright Spec 规范代码编译器管道
import type { ReplayStep } from "../types.js";

export interface CompileOptions {
  title?: string;
  baseUrl?: string;
}

/**
 * 将录制序列转译为符合行业标准规范的原生 Playwright TypeScript 测试代码
 */
export function compileToPlaywrightSpec(steps: ReplayStep[], options: CompileOptions = {}): string {
  const testTitle = options.title || "E2E Regression Flow";
  const lines: string[] = [];

  lines.push(`// 自动编译生成的 Playwright E2E 测试用例`);
  lines.push(`// 来源: dsh-browser 录制回放引擎`);
  lines.push(`import { test, expect } from "@playwright/test";`);
  lines.push(``);
  lines.push(`test.describe(${JSON.stringify(testTitle)}, () => {`);
  lines.push(`  test("执行业务操作与回归断言", async ({ page }) => {`);

  for (const step of steps) {
    const { tool, args = {} } = step;

    switch (tool) {
      case "browser_open": {
        const url = args.url || options.baseUrl || "/";
        lines.push(`    await page.goto(${JSON.stringify(url)});`);
        break;
      }

      case "browser_click": {
        const sel = args.selector || (args.ref ? `[data-ref="${args.ref}"]` : "button");
        lines.push(`    await page.locator(${JSON.stringify(sel)}).click();`);
        break;
      }

      case "browser_type": {
        const sel = args.selector || "input";
        const text = args.text ?? "";
        lines.push(`    await page.locator(${JSON.stringify(sel)}).fill(${JSON.stringify(text)});`);
        break;
      }

      case "browser_press": {
        const sel = args.selector || "body";
        const key = args.key || "Enter";
        lines.push(`    await page.locator(${JSON.stringify(sel)}).press(${JSON.stringify(key)});`);
        break;
      }

      case "browser_select": {
        const sel = args.selector || "select";
        const option = args.option || "";
        lines.push(
          `    await page.locator(${JSON.stringify(sel)}).selectOption({ label: ${JSON.stringify(option)} });`,
        );
        break;
      }

      case "browser_wait": {
        const ms = Number(args.ms) || 1000;
        lines.push(`    await page.waitForTimeout(${ms});`);
        break;
      }

      case "browser_wait_for": {
        if (args.url) {
          lines.push(`    await page.waitForURL(${JSON.stringify(args.url)});`);
        } else if (args.selector) {
          const state = args.state || "visible";
          lines.push(
            `    await page.locator(${JSON.stringify(args.selector)}).waitFor({ state: ${JSON.stringify(state)} });`,
          );
        } else if (args.condition?.bridge !== undefined || args.bridge !== undefined) {
          lines.push(
            `    // bridge 条件请在接入 vite-plugin-dsh-bridge 的环境手动断言: await __DSH_BRIDGE__.<method>(...)`,
          );
        }
        break;
      }

      case "browser_assert": {
        const sel = args.selector || "body";
        if (args.text) {
          lines.push(
            `    await expect(page.locator(${JSON.stringify(sel)})).toContainText(${JSON.stringify(args.text)});`,
          );
        } else if (args.visible !== undefined) {
          if (args.visible) {
            lines.push(`    await expect(page.locator(${JSON.stringify(sel)})).toBeVisible();`);
          } else {
            lines.push(`    await expect(page.locator(${JSON.stringify(sel)})).toBeHidden();`);
          }
        } else if (args.condition?.bridge !== undefined || args.bridge !== undefined) {
          const bridge = args.condition?.bridge ?? args.bridge;
          lines.push(
            `    // bridge 断言请在接入 vite-plugin-dsh-bridge 的环境手动执行: ` +
              `const v = await __DSH_BRIDGE__.${String(bridge?.method ?? "method")}(); expect(v).toBeTruthy();`,
          );
        }
        break;
      }

      case "browser_form_fill": {
        const fields = args.fields || {};
        for (const [k, v] of Object.entries(fields)) {
          lines.push(
            `    // 批量表单填充: ${k} = ${v}`,
          );
          lines.push(
            `    await page.getByLabel(${JSON.stringify(k)}).fill(${JSON.stringify(String(v))}).catch(async () => {`,
          );
          lines.push(
            `      await page.locator(${JSON.stringify(k)}).fill(${JSON.stringify(String(v))});`,
          );
          lines.push(`    });`);
        }
        if (args.submitButton) {
          lines.push(
            `    await page.getByRole("button", { name: ${JSON.stringify(args.submitButton)} }).click().catch(async () => {`,
          );
          lines.push(
            `      await page.locator(${JSON.stringify(args.submitButton)}).click();`,
          );
          lines.push(`    });`);
        }
        break;
      }

      default: {
        lines.push(`    // [${tool}] ${JSON.stringify(args)}`);
        break;
      }
    }
  }

  lines.push(`  });`);
  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}
