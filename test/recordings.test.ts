import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeName, recordingsDir, saveRecordingFile, loadRecordings, deleteRecordingFile, listRecordings, recordingDetail, deleteRecording } from "../src/browser/recordings.js";
import { savedRecordings } from "../src/browser/session.js";

let dir: string;
const origHome = process.env.DSH_HOME;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dsh-browser-recordings-"));
  process.env.DSH_HOME = dir;
  savedRecordings.clear();
});

afterAll(() => {
  if (origHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = origHome;
  rmSync(dir, { recursive: true, force: true });
});

describe("recordings 持久化", () => {
  it("目录落在 $DSH_HOME/.dsh-browser/recordings", () => {
    expect(recordingsDir()).toBe(join(dir, ".dsh-browser", "recordings"));
  });

  it("save 写盘,load 读回并合并进内存表", () => {
    const steps = [
      { tool: "browser_open", args: { url: "https://example.com" } },
      { tool: "browser_assert", args: { condition: { text: "ok" } } },
    ];
    const file = saveRecordingFile("login-flow", steps);
    expect(file).toContain(join(dir, ".dsh-browser", "recordings", "login-flow.json"));
    expect(readdirSync(join(dir, ".dsh-browser", "recordings"))).toContain("login-flow.json");
    // 磁盘内容含步骤
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.steps).toHaveLength(2);

    savedRecordings.clear();
    const loaded = loadRecordings();
    expect(loaded).toBe(1);
    expect(savedRecordings.has("login-flow")).toBe(true);
    expect(savedRecordings.get("login-flow")!.steps[0].tool).toBe("browser_open");
  });

  it("load 跳过坏文件", () => {
    // 先清掉正常文件,只留坏 json,验证坏文件被跳过且不报错。
    deleteRecordingFile("login-flow");
    savedRecordings.clear();
    const dir2 = join(dir, ".dsh-browser", "recordings");
    writeFileSync(join(dir2, "broken.json"), "{not json");
    const loaded = loadRecordings();
    expect(loaded).toBe(0);
    expect(savedRecordings.size).toBe(0);
  });

  it("delete 同步删文件", () => {
    // 先造一个可删的录制
    const steps = [{ tool: "browser_open", args: { url: "https://x.com" } }];
    saveRecordingFile("temp-rec", steps);
    savedRecordings.set("temp-rec", { steps, savedAt: Date.now() });
    expect(savedRecordings.delete("temp-rec")).toBe(true);
    expect(deleteRecordingFile("temp-rec")).toBe(true);
    expect(readdirSync(join(dir, ".dsh-browser", "recordings"))).not.toContain("temp-rec.json");
  });

  it("safeName 防路径穿越", () => {
    const s = safeName("../../etc/passwd");
    expect(s).not.toContain("..");
    expect(s).not.toContain("/");
    expect(safeName("我的录制")).toBe("____");
    expect(safeName("a-b_c.d")).toBe("a-b_c.d");
  });

  it("listRecordings 与 recordingDetail", () => {
    savedRecordings.clear();
    deleteRecordingFile("broken");
    const steps = [{ tool: "browser_open", args: { url: "https://x.com" } }];
    saveRecordingFile("list-me", steps);
    savedRecordings.set("list-me", { steps, savedAt: 1234 });
    const list = listRecordings();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "list-me", steps: 1, savedAt: 1234 });
    expect(list[0].preview).toContain("browser_open");
    const detail = recordingDetail("list-me");
    expect(detail?.steps[0].tool).toBe("browser_open");
    expect(recordingDetail("nope")).toBeUndefined();
  });

  it("deleteRecording 同步内存与磁盘", () => {
    savedRecordings.clear();
    const steps = [{ tool: "browser_open", args: {} }];
    saveRecordingFile("del-me", steps);
    savedRecordings.set("del-me", { steps, savedAt: Date.now() });
    expect(deleteRecording("del-me")).toBe(true);
    expect(savedRecordings.has("del-me")).toBe(false);
    expect(readdirSync(join(dir, ".dsh-browser", "recordings"))).not.toContain("del-me.json");
    expect(deleteRecording("del-me")).toBe(false); // 已不存在
  });
});
