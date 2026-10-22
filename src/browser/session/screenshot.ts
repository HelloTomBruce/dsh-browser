// dsh-browser · 会话管理 — 截图清理与轮转
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** 最近一次 browser_screenshot 实际写入的目录(供定时清扫复用,避免相对路径解析漂移)。 */
let lastScreenshotDir: string | null = null;

/** 记录最近一次截图目录(截图工具调用时写入)。 */
export function noteScreenshotDir(dir: string): void {
  lastScreenshotDir = dir;
}

/** 定时清扫入口:若已知截图目录则按当前配置清理。 */
export function sweepScreenshotDir(opts: { maxAgeDays?: number; maxCount?: number }): number {
  if (lastScreenshotDir === null) return 0;
  return cleanupScreenshots(lastScreenshotDir, opts);
}

/**
 * 清理截图目录里的 .png 文件:按修改时间保留最新的 maxCount 个,
 * 并删除超过 maxAgeDays 天的旧文件。只处理目录直属文件,不递归;
 * 单个文件删除失败(被占用等)静默跳过。返回删除数量。
 */
export function cleanupScreenshots(dir: string, opts: { maxAgeDays?: number; maxCount?: number }): number {
  const maxAgeDays = Number(opts.maxAgeDays ?? 0) || 0;
  const maxCount = Math.max(0, Number(opts.maxCount ?? 0) || 0);
  if (maxAgeDays <= 0 && maxCount <= 0) return 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0; // 目录不存在
  }
  const now = Date.now();
  const cutoff = maxAgeDays > 0 ? now - maxAgeDays * 86_400_000 : 0;
  const files: { name: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.png$/i.test(entry.name)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(join(dir, entry.name)).mtimeMs;
    } catch {
      continue;
    }
    files.push({ name: entry.name, mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs); // 最新在前
  let removed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const tooOld = cutoff > 0 && file.mtimeMs < cutoff;
    const tooMany = maxCount > 0 && i >= maxCount;
    if (!tooOld && !tooMany) continue;
    try {
      rmSync(join(dir, file.name), { force: true });
      removed++;
    } catch {
      /* 被占用等,跳过 */
    }
  }
  return removed;
}
