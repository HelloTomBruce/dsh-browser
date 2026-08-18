// dsh-browser · 录制持久化($DSH_HOME/.dsh-browser/recordings/*.json)
//
// browser_record save 写入磁盘,插件 apply 时加载合并进内存表;delete 同步删文件。
// 写文件用 tmp + rename 原子替换,避免半写。名字只保留 [A-Za-z0-9._-],
// 防止路径穿越。

import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { savedRecordings } from "./session.js";

/** 录制存储目录($DSH_HOME/.dsh-browser/recordings)。 */
export function recordingsDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  return join(home, ".dsh-browser", "recordings");
}

/** 名字安全化:只保留字母数字 . _ -,连续点压成下划线防路径穿越。 */
export function safeName(name: string): string {
  return name.replace(/\.\./g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
}

/** 加载目录下所有 .json 录制进内存表;返回加载数量。坏文件静默跳过。 */
export function loadRecordings(): number {
  const dir = recordingsDir();
  let loaded = 0;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
          steps?: { tool: string; args: any }[];
          savedAt?: number;
        };
        if (data !== null && typeof data === "object" && Array.isArray(data.steps)) {
          savedRecordings.set(file.slice(0, -".json".length), {
            steps: data.steps,
            savedAt: typeof data.savedAt === "number" ? data.savedAt : Date.now(),
          });
          loaded++;
        }
      } catch {
        /* 坏文件跳过 */
      }
    }
  } catch {
    /* 目录不存在 */
  }
  return loaded;
}

/** 写一个录制到磁盘(原子替换);返回文件路径。 */
export function saveRecordingFile(name: string, steps: { tool: string; args: any }[]): string {
  const dir = recordingsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeName(name)}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ steps, savedAt: Date.now() }, null, 2));
  renameSync(tmp, file);
  return file;
}

/** 删除磁盘上的录制文件;返回是否存在并删除。 */
export function deleteRecordingFile(name: string): boolean {
  const file = join(recordingsDir(), `${safeName(name)}.json`);
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 录制列表(面板 / browser_record list 共用)。 */
export function listRecordings(): Array<{ name: string; steps: number; savedAt: number; preview: string }> {
  return [...savedRecordings.entries()].map(([name, r]) => ({
    name,
    steps: r.steps.length,
    savedAt: r.savedAt,
    preview: r.steps.slice(0, 3).map((s) => s.tool).join(", "),
  }));
}

/** 录制详情(面板展开查看步骤)。 */
export function recordingDetail(name: string): { name: string; steps: { tool: string; args: any }[] } | undefined {
  const r = savedRecordings.get(name);
  if (r === undefined) return undefined;
  return { name, steps: r.steps };
}

/** 删除录制(内存 + 磁盘同步);返回是否存在并删除。 */
export function deleteRecording(name: string): boolean {
  const existed = savedRecordings.delete(name);
  if (existed) deleteRecordingFile(name);
  return existed;
}
