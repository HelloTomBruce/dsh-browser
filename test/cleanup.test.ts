
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupScreenshots } from "../src/browser/session.js";

let dir: string;

/** 设置文件修改时间(毫秒时间戳,utimes 只支持秒级精度)。 */
function setMtime(name: string, tsMs: number): void {
  const seconds = Math.floor(tsMs / 1000);
  utimesSync(join(dir, name), seconds, seconds);
}

beforeAll(() => {
  dir = join(tmpdir(), `dsh-browser-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  writeFileSync(join(dir, "new.png"), "x");
  writeFileSync(join(dir, "mid.png"), "x");
  writeFileSync(join(dir, "old.png"), "x");
  setMtime("old.png", now - 86_400_000 * 2); // 2 天前
  setMtime("mid.png", now - 3_600_000); // 1 小时前
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cleanupScreenshots", () => {
  it("按数量保留最新 maxCount 个", () => {
    const removed = cleanupScreenshots(dir, { maxCount: 2 });
    expect(removed).toBe(1);
    const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    expect(files.sort()).toEqual(["mid.png", "new.png"]);
    // 恢复 old.png 供后续用例
    writeFileSync(join(dir, "old.png"), "x");
    setMtime("old.png", Date.now() - 86_400_000 * 2);
  });

  it("按天数删除超龄文件", () => {
    const removed = cleanupScreenshots(dir, { maxAgeDays: 1 });
    expect(removed).toBe(1); // old.png(2 天前)被删
    const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
    expect(files).not.toContain("old.png");
  });

  it("目录不存在返回 0", () => {
    expect(cleanupScreenshots(join(dir, "nope"), { maxCount: 5 })).toBe(0);
  });

  it("无规则时不删除", () => {
    expect(cleanupScreenshots(dir, {})).toBe(0);
  });

  it("只清理 .png,不碰其它文件", () => {
    writeFileSync(join(dir, "notes.txt"), "keep");
    cleanupScreenshots(dir, { maxCount: 1 });
    expect(readdirSync(dir)).toContain("notes.txt");
    rmSync(join(dir, "notes.txt"));
  });
});
