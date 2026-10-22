// dsh-browser · 浏览器工具 — 环境自检与诊断探针
import { accessSync, constants as fsConstants, existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { currentProfile, loadPlaywright, stateOf, profileStates } from "../session.js";
import { workspaceBaseDir } from "../../lib/tools.js";
/** 面板自检探针(由 index.ts 在注册 API 后注入;fetch 本机 /status)。 */
let doctorProbe = null;
export function setDoctorProbe(fn) {
    doctorProbe = fn;
}
/** 目录可写性检查(mkdir + 写探针文件 + 删除)。导出供测试。 */
export function checkWritableDir(dir) {
    try {
        mkdirSync(dir, { recursive: true });
        const probe = join(dir, `.doctor-probe-${Date.now()}`);
        writeFileSync(probe, "ok");
        unlinkSync(probe);
        return { ok: true, detail: dir };
    }
    catch (e) {
        return { ok: false, detail: `${dir} — ${e instanceof Error ? e.message : String(e)}` };
    }
}
/** 可执行文件存在性检查(executablePath 显式配置用)。导出供测试。 */
export function checkExecutable(path) {
    if (!existsSync(path)) {
        return {
            name: "executable",
            ok: false,
            detail: `executablePath 指向的文件不存在: ${path}`,
            advice: "修正 cordis.patch.yml 的 browser.executablePath,或清空该字段改用 channel 自动探测",
        };
    }
    try {
        accessSync(path, fsConstants.X_OK);
    }
    catch {
        return {
            name: "executable",
            ok: false,
            detail: `文件存在但不可执行: ${path}`,
            advice: "chmod +x 或确认路径指向浏览器主程序",
        };
    }
    const st = statSync(path);
    return {
        name: "executable",
        ok: st.isFile(),
        detail: st.isFile() ? path : `不是普通文件: ${path}`,
        ...(st.isFile() ? {} : { advice: "确认路径指向浏览器可执行文件而非目录" }),
    };
}
/** 一次性健康诊断:不启动浏览器,只做静态/本地检查。 */
export async function doctorTool(config, _args, exec) {
    const checks = [];
    // 1) 浏览器可执行文件
    if (config.executablePath) {
        checks.push(checkExecutable(config.executablePath));
    }
    else {
        const channel = config.channel ?? "auto";
        checks.push({
            name: "channel",
            ok: true,
            detail: channel === "auto" || channel === ""
                ? "auto:按平台序探测已装浏览器(chrome → msedge → chromium;Windows 为 msedge 优先),启动失败会提示安装"
                : `channel = ${channel}(由 Playwright 在首次启动时解析)`,
        });
        // 附带看一眼 playwright 自带 chromium 是否可用(作为最后回退)
        try {
            const pw = await loadPlaywright();
            const bundled = pw.chromium.executablePath();
            checks.push({
                name: "bundled-chromium",
                ok: existsSync(bundled),
                detail: existsSync(bundled) ? bundled : `playwright 捆绑 chromium 未安装(${bundled})`,
                ...(existsSync(bundled)
                    ? {}
                    : { advice: "可选:npx playwright install chromium 安装兜底浏览器,或依赖系统已装的 Edge/Chrome" }),
            });
        }
        catch {
            checks.push({
                name: "playwright-core",
                ok: false,
                detail: "playwright-core 不可用",
                advice: "在 profile 中安装 playwright-core(dsh plugin --profile web add playwright-core)",
            });
        }
    }
    // 2) userDataDir 可写性
    if (config.userDataDir) {
        const w = checkWritableDir(config.userDataDir);
        checks.push({
            name: "userDataDir",
            ok: w.ok,
            detail: w.ok ? `${config.userDataDir}(登录态将持久化)` : w.detail,
            ...(!w.ok ? { advice: "确认目录存在且当前用户可写" } : {}),
        });
    }
    else {
        checks.push({ name: "userDataDir", ok: true, detail: "未配置(登录态随会话,DSH 重启后失效)" });
    }
    // 3) 工作区基准目录 + 截图/下载/基线目录
    const baseDir = workspaceBaseDir(config, exec);
    const baseWritable = checkWritableDir(baseDir);
    checks.push({
        name: "workspaceDir",
        ok: baseWritable.ok,
        detail: baseWritable.ok
            ? `${baseDir}(来源: ${config.workspaceDir ? "config.workspaceDir" : "会话 cwd 探测"})`
            : baseWritable.detail,
        ...(!baseWritable.ok ? { advice: "设置 config.workspaceDir 钉死基准目录,或修正会话工作区权限" } : {}),
    });
    for (const [name, dir] of [
        ["screenshotDir", config.screenshotDir ?? ".dsh-browser/screenshots"],
        ["downloadDir", config.downloadDir ?? ".dsh-browser/downloads"],
        ["baselineDir", config.baselineDir ?? ".dsh-browser/baselines"],
    ]) {
        const abs = isAbsolute(dir) ? dir : resolve(baseDir, dir);
        const w = checkWritableDir(abs);
        checks.push({
            name,
            ok: w.ok,
            detail: w.ok ? abs : w.detail,
            ...(!w.ok ? { advice: `检查 ${abs} 的创建/写权限(父目录需可写)` } : {}),
        });
    }
    // 4) 当前会话状态(信息性,恒 ok)
    const state = stateOf();
    checks.push({
        name: "session",
        ok: true,
        detail: `当前 profile "${currentProfile}"${state.browser !== null ? " 已启动浏览器" : " 浏览器未启动(首次调用工具时自动启动)"} · ${state.pages.size} 个标签 · 共 ${profileStates.size} 个 profile`,
    });
    // 5) 面板 API 可达性(探针由 index.ts 注入;无 webServer 的进程跳过)
    const basePath = config.basePath ?? "/browser";
    if (doctorProbe !== null) {
        try {
            const r = await doctorProbe(basePath);
            checks.push({ name: "panel", ok: r.ok, detail: r.detail, ...(r.advice ? { advice: r.advice } : {}) });
        }
        catch (e) {
            checks.push({
                name: "panel",
                ok: false,
                detail: `探针执行失败: ${e instanceof Error ? e.message : String(e)}`,
                advice: `在浏览器打开 http://<DSH地址>${basePath}/status 手动验证`,
            });
        }
    }
    else {
        checks.push({ name: "panel", ok: true, detail: `本进程无 webServer(工具半),面板 API 基路径 ${basePath}` });
    }
    const failed = checks.filter((c) => !c.ok).length;
    return {
        checks,
        summary: { ok: failed === 0, passed: checks.length - failed, failed },
    };
}
//# sourceMappingURL=doctor.js.map