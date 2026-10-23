import { describe, expect, it } from "vitest";
import { gaussianRandom } from "../src/browser/stealth/keyboard.js";
import { generateBezierPath } from "../src/browser/stealth/mouse.js";
import { isBotSensitiveUrl } from "../src/browser/tools/interaction.js";

describe("拟人化平滑鼠标与击键引擎 (Stealth & Human-like)", () => {
  it("三次贝塞尔轨迹起点与终点严格精准，中间点呈自然平滑曲线", () => {
    const start = { x: 50, y: 100 };
    const end = { x: 500, y: 400 };
    const steps = 25;

    const path = generateBezierPath(start, end, steps);
    expect(path.length).toBe(steps + 1);

    // 起点与终点
    expect(path[0].x).toBe(start.x);
    expect(path[0].y).toBe(start.y);
    expect(path[path.length - 1].x).toBe(end.x);
    expect(path[path.length - 1].y).toBe(end.y);

    // 中间点不严格在直线上 (存在物理弯曲与控制点偏移)
    let hasCurvature = false;
    for (let i = 1; i < path.length - 1; i++) {
      const pt = path[i];
      // 线性插值期望坐标
      const expectedLinearY = start.y + (end.y - start.y) * (i / steps);
      if (Math.abs(pt.y - expectedLinearY) > 0.5) {
        hasCurvature = true;
        break;
      }
    }
    expect(hasCurvature).toBe(true);
  });

  it("高斯击键延时生成器符合正态分布且严格截断在有界区间", () => {
    const samples: number[] = [];
    const min = 35;
    const max = 140;
    const mean = 65;

    for (let i = 0; i < 1000; i++) {
      const val = gaussianRandom(mean, 18, min, max);
      expect(val).toBeGreaterThanOrEqual(min);
      expect(val).toBeLessThanOrEqual(max);
      samples.push(val);
    }

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    // 均值应贴近 65ms (允许采样误差 ±3ms)
    expect(avg).toBeGreaterThan(61);
    expect(avg).toBeLessThan(69);
  });

  it("环境特征自适应识别 (Bot 敏感页与风控认证页判定)", () => {
    expect(isBotSensitiveUrl("https://auth.company.com/login")).toBe(true);
    expect(isBotSensitiveUrl("https://cloudflare.com/challenge/turnstile")).toBe(true);
    expect(isBotSensitiveUrl("https://portal.internal/admin/signin")).toBe(true);
    expect(isBotSensitiveUrl("https://news.ycombinator.com/item?id=123")).toBe(false);
  });
});
