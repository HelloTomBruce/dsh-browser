// browser_doctor 纯逻辑单元测试:可执行文件检查、目录可写性检查、
// doctorTool 输出结构(summary 统计 / 失败项带 advice / 探针注入)。
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorTool, checkExecutable, checkWritableDir, setDoctorProbe } from "../src/browser/tools.js";
import type { BrowserConfig } from "../src/browser/types.js";

const CONFIG: BrowserConfig = { channel: "auto", headless: true, timeoutMs: 5000 };

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "doctor-"));
  return () => rmSync(tmp, { recursive: true, force: true });
});

describe("checkWritableDir", () => {
  it("可写目录通过(自动创建)", () => {
    const dir = join(tmp, "a/b/c");
    expect(checkWritableDir(dir)).toEqual({ ok: true, detail: dir });
  });

  it("不可写目录失败并带原因", () => {
    const dir = join(tmp, "ro");
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    const r = checkWritableDir(join(dir, "sub"));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("ro");
    chmodSync(dir, 0o700); // 恢复以便清理
  });
});

describe("checkExecutable", () => {
  it("存在的可执行文件通过", () => {
    const f = join(tmp, "bin");
    writeFileSync(f, "#!/bin/sh\n", { mode: 0o755 });
    const r = checkExecutable(f);
    expect(r.ok).toBe(true);
  });

  it("不存在的路径失败并给修复建议", () => {
    const r = checkExecutable(join(tmp, "nope"));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("不存在");
    expect(r.advice).toContain("executablePath");
  });

  it("目录而非文件失败", () => {
    const r = checkExecutable(tmp);
    expect(r.ok).toBe(false);
  });
});

describe("doctorTool", () => {
  it("全绿时 summary.ok=true,checks 覆盖关键项", async () => {
    const r = await doctorTool({ ...CONFIG, workspaceDir: tmp, executablePath: process.execPath }, {});
    const names = (r.checks as any[]).map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["executable", "userDataDir", "workspaceDir", "screenshotDir", "downloadDir", "baselineDir", "session", "panel"]),
    );
    expect(r.summary.failed).toBe(0);
    expect(r.summary.ok).toBe(true);
    expect(r.summary.passed).toBe(r.checks.length);
  });

  it("executablePath 配错时该项失败且带建议", async () => {
    const r = await doctorTool({ ...CONFIG, workspaceDir: tmp, executablePath: join(tmp, "nope") }, {});
    const bad = (r.checks as any[]).find((c) => c.name === "executable");
    expect(bad.ok).toBe(false);
    expect(bad.advice).toBeDefined();
    expect(r.summary.failed).toBe(1);
    expect(r.summary.ok).toBe(false);
  });

  it("工作区基准目录来源标注 config.workspaceDir", async () => {
    const r = await doctorTool({ ...CONFIG, workspaceDir: tmp }, {});
    const ws = (r.checks as any[]).find((c) => c.name === "workspaceDir");
    expect(ws.detail).toContain("config.workspaceDir");
  });

  it("面板探针:注入后可达通过 / 失败报错", async () => {
    setDoctorProbe(async () => ({ ok: true, detail: "面板 API 可达" }));
    const ok = await doctorTool({ ...CONFIG, workspaceDir: tmp }, {});
    expect((ok.checks as any[]).find((c) => c.name === "panel").ok).toBe(true);

    setDoctorProbe(async () => ({ ok: false, detail: "超时", advice: "检查端口" }));
    const bad = await doctorTool({ ...CONFIG, workspaceDir: tmp }, {});
    const panel = (bad.checks as any[]).find((c) => c.name === "panel");
    expect(panel.ok).toBe(false);
    expect(panel.advice).toBe("检查端口");
    setDoctorProbe(null); // 还原,避免影响其他测试
  });
});
