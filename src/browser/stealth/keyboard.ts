// dsh-browser · 拟人化高斯击键引擎 (Gaussian Keystroke Driver)
import type { Page } from "playwright-core";

export interface TypeOptions {
  speed?: "slow" | "normal" | "fast";
}

/**
 * 基于 Box-Muller 变换的高斯分布随机数生成器
 */
export function gaussianRandom(
  mean = 65,
  stdev = 18,
  min = 35,
  max = 140,
): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const val = num * stdev + mean;
  return Math.max(min, Math.min(max, Math.round(val)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 拟人化敲击键盘输入文本
 */
export async function humanType(
  page: Page,
  text: string,
  options: TypeOptions = {},
): Promise<void> {
  const speed = options.speed ?? "normal";
  const mean = speed === "fast" ? 45 : speed === "slow" ? 95 : 65;
  const stdev = speed === "fast" ? 12 : speed === "slow" ? 25 : 18;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char);

    // 标点符号与空格带有更长的人脑停顿与节奏感 (120~220ms)
    const isPauseChar = [",", ".", "!", "?", " ", "\n", "，", "。"].includes(char);
    const delay = isPauseChar
      ? gaussianRandom(mean * 2.2, stdev * 1.5, 90, 240)
      : gaussianRandom(mean, stdev, 30, 150);

    await sleep(delay);
  }
}
