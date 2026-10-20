// dsh-browser · 录制持久化($DSH_HOME/.dsh-browser/recordings/*.json)
//
// browser_record save 写入磁盘,插件 apply 时加载合并进内存表;delete 同步删文件。
// 写文件用 tmp + rename 原子替换,避免半写。名字只保留 [A-Za-z0-9._-],
// 防止路径穿越。

import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { savedRecordings } from "./session.js";
import type { ReplayStep } from "./types.js";

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
          formatVersion?: number;
          steps?: ReplayStep[];
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

/** 写一个录制到磁盘(原子替换);返回文件路径。formatVersion 2 起步骤可带 meta(选择器指纹)与 {{var}} 占位符。 */
export function saveRecordingFile(name: string, steps: ReplayStep[]): string {
  const dir = recordingsDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeName(name)}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ formatVersion: 2, steps, savedAt: Date.now() }, null, 2));
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

/**
 * 磁盘热重载:录制文件被外部编辑(手修 JSON)后,同会话内 browser_replay 仍用内存旧缓存。
 * 比较文件 mtime 与内存 savedAt(留 2s 余量容忍写入延迟),更新过则重新加载进内存表。
 * 返回是否发生了重载;文件不存在或损坏时静默保留内存版。
 */
export function reloadRecordingIfChanged(name: string): boolean {
  const mem = savedRecordings.get(name);
  const file = join(recordingsDir(), `${safeName(name)}.json`);
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return false;
  }
  if (mem !== undefined && mtime <= mem.savedAt + 2_000) return false;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { formatVersion?: number; steps?: ReplayStep[]; savedAt?: number };
    if (data !== null && typeof data === "object" && Array.isArray(data.steps)) {
      savedRecordings.set(name, {
        steps: data.steps,
        // 记 mtime 而非文件内 savedAt:手改只更新 mtime,用它能识别后续再次编辑。
        savedAt: mtime,
      });
      return true;
    }
  } catch {
    /* 坏文件:保留内存版 */
  }
  return false;
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
export function recordingDetail(name: string): { name: string; steps: ReplayStep[] } | undefined {
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
