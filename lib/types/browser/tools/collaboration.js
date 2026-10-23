import { getPage, activePage, pageIdentity, pageRef, setPauseInstruction, clearPauseInstruction, setPendingConfirm, getPendingConfirm, clearPendingConfirm, } from "../session.js";
import { injectWalker } from "../walker.js";
import { pollCondition } from "./testing.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * 操作预告高亮:agent 即将 click/type/select/press 的元素在页面上琥珀色描边
 * ~1.5 秒。异步不阻塞(fire-and-forget,任何失败静默),不影响操作时序。
 */
export function previewHighlight(page, selector, label) {
    if (page === null || selector === "")
        return;
    void page
        .evaluate((arg) => {
        const el = document.querySelector(arg.selector);
        if (el === null)
            return;
        const rect = el.getBoundingClientRect();
        const box = document.createElement("div");
        box.setAttribute("data-dsh-preview", "");
        Object.assign(box.style, {
            position: "fixed",
            left: `${rect.left - 2}px`,
            top: `${rect.top - 2}px`,
            width: `${rect.width + 4}px`,
            height: `${rect.height + 4}px`,
            border: "2px solid #f59e0b",
            borderRadius: "4px",
            background: "rgba(245, 158, 11, 0.08)",
            pointerEvents: "none",
            zIndex: "2147483646",
            boxSizing: "border-box",
            transition: "opacity 0.3s",
        });
        const tip = document.createElement("div");
        Object.assign(tip.style, {
            position: "absolute",
            left: "0",
            top: "-20px",
            font: "12px/1.4 -apple-system,'PingFang SC',sans-serif",
            color: "#fff",
            background: "#f59e0b",
            padding: "1px 6px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
        });
        tip.textContent = `agent: ${arg.label}`;
        box.appendChild(tip);
        document.documentElement.appendChild(box);
        setTimeout(() => {
            box.style.opacity = "0";
            setTimeout(() => box.remove(), 400);
        }, 1_200);
    }, { selector, label })
        .catch(() => {
        /* 页面导航/关闭:高亮本就是尽力而为 */
    });
}
/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 提示用户在浏览器窗口中完成登录(输入/扫码/双因素)。基于通用条件引擎:
 * successSelector / successUrl 指定完成条件,两者都不给则以 URL 跳转视为完成。
 * 超时返回 loggedIn:false(不抛错)。
 */
export async function waitForLoginTool(config, args) {
    const page = await getPage(config);
    const startUrl = page.url();
    let condition;
    if (args.successSelector) {
        condition = { selector: String(args.successSelector), state: "visible" };
    }
    else if (args.successUrl) {
        condition = { url: String(args.successUrl) };
    }
    else {
        condition = {
            eval: `location.href !== ${JSON.stringify(startUrl)} && location.href !== "about:blank"`,
        };
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 120_000) || 120_000, 5_000), 600_000);
    const result = await pollCondition(page, condition, timeoutMs, 2_000);
    return { loggedIn: result.ok, ...(await pageIdentity(page)) };
}
/**
 * 人工接管等待(通用版 wait_for_login):agent 把控制权交还给用户(验证码 /
 * 二次确认 / 人工复核等)。instruction 会显示在实时画面面板;完成条件三选一:
 * successSelector(元素出现)/ successUrl(URL 正则)/ 两者都不给则以
 * URL 变化或页面内容签名变化视为完成。轮询间隔 2 秒,超时返回 completed:false
 * (不抛错)。导出 runPauseOnPage 供测试注入 fake page。
 */
export async function runPauseOnPage(page, args) {
    const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
    if (!instruction) {
        throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 300_000) || 300_000, 1_000), 600_000);
    let startUrl = "";
    try {
        startUrl = page.url();
    }
    catch {
        /* 页面暂不可用(导航中/已关闭):交给轮询阶段统一记录 detail */
    }
    const startedAt = Date.now();
    const pageSignature = async () => {
        try {
            return await page.evaluate(() => {
                const body = document.body;
                return `${location.href}|${body ? body.innerText.length : 0}|${document.querySelectorAll("input,button,a").length}`;
            });
        }
        catch {
            return page.url();
        }
    };
    const startSig = args.successSelector || args.successUrl ? "" : await pageSignature();
    let completed = false;
    let detail = `等待人工操作超时(${timeoutMs}ms)`;
    setPauseInstruction(instruction);
    try {
        const deadline = startedAt + timeoutMs;
        while (Date.now() < deadline) {
            try {
                if (args.successSelector) {
                    completed = await page.locator(String(args.successSelector)).first().isVisible();
                }
                else if (args.successUrl) {
                    completed = new RegExp(String(args.successUrl)).test(page.url());
                }
                else {
                    completed = page.url() !== startUrl || (await pageSignature()) !== startSig;
                }
            }
            catch (e) {
                completed = false;
                detail = `检查完成条件出错: ${e instanceof Error ? e.message : String(e)}`;
            }
            if (completed) {
                detail = "人工操作完成";
                break;
            }
            await page.waitForTimeout(2_000);
        }
    }
    finally {
        clearPauseInstruction();
    }
    return { completed, waitedMs: Date.now() - startedAt, detail };
}
/** 人工接管等待工具入口(缺 instruction 在启动浏览器前即校验,失败更快)。 */
export async function pauseForHumanTool(config, args) {
    const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
    if (!instruction) {
        throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
    }
    const page = await getPage(config);
    const result = await runPauseOnPage(page, args);
    return {
        completed: result.completed,
        status: result.completed ? "completed" : "timedOut",
        instruction,
        detail: result.detail,
        waitedMs: result.waitedMs,
        ...(await pageIdentity(page)),
    };
}
/**
 * 敏感操作审批:agent 在执行提交/删除/支付类动作前调用,把审批请求推到实时
 * 画面面板,挂起等待用户点「允许/拒绝」。超时视为拒绝(fail-closed)。
 * 用户允许时返回 { decision: "allowed", ... };拒绝/超时**抛错**(消息含原因),
 * 使 live 调用与 replay/batch 步骤统一按失败处理,agent 不应继续敏感动作。
 * 决策通过 session.resolveConfirm(面板 POST)写入。
 */
export async function confirmTool(config, args) {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (!reason) {
        throw new Error("缺少 reason: 请说明要执行什么敏感操作、为什么需要审批(如「提交白名单表单,会产生线上数据变更」)");
    }
    const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? config.confirmTimeoutMs ?? 60_000) || 60_000, 1_000), 600_000);
    const id = `cfm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
        id,
        reason,
        tool: typeof args.tool === "string" && args.tool ? args.tool : undefined,
        args: args.args && typeof args.args === "object" ? args.args : undefined,
        startedAt: Date.now(),
    };
    setPendingConfirm(entry);
    const startedAt = Date.now();
    let decision = "timeout";
    let detail = `等待审批超时(${timeoutMs}ms),按拒绝处理`;
    try {
        const deadline = startedAt + timeoutMs;
        while (Date.now() < deadline) {
            await sleep(500);
            const pending = getPendingConfirm();
            if (pending === null || pending.id !== id) {
                // 被并发的新审批取代:本次按拒绝处理,避免误放行
                decision = "denied";
                detail = "审批请求已被新的审批取代,按拒绝处理";
                break;
            }
            if (pending.decision !== undefined) {
                decision = pending.decision;
                detail = decision === "allowed" ? "用户允许执行" : "用户拒绝执行";
                break;
            }
        }
    }
    finally {
        // 只有仍是本次请求时才清理(被取代时不动新请求)
        const pending = getPendingConfirm();
        if (pending !== null && pending.id === id)
            clearPendingConfirm();
    }
    if (decision !== "allowed") {
        throw new Error(`敏感操作被拒绝: ${reason} — ${detail}`);
    }
    return { decision, id, reason, waitedMs: Date.now() - startedAt, detail };
}
// ---------------------------------------------------------------------------
// F1 confirm 自动拦截(confirmMode: "auto" 或 confirmPolicies 多维策略引擎):
// sensitiveTools / 策略链在工具执行前解析目标 selector/ref → 页内取元素统一描述
// (walker describeElement) → 策略规则链判定
// → 命中即复用审批管线(confirmTool, 弹面板卡等待允许/拒绝/超时)。
// 未命中直接放行(一次页内 evaluate, 与 preview 高亮同量级, 无感知延迟)。
// ---------------------------------------------------------------------------
import { evaluatePolicy, sensitiveHits, DEFAULT_SENSITIVE_PATTERNS, DEFAULT_SENSITIVE_TOOLS, } from "../policy/engine.js";
export { sensitiveHits, DEFAULT_SENSITIVE_PATTERNS, DEFAULT_SENSITIVE_TOOLS };
/** 敏感判定的页内目标描述提取(walker 统一元素描述,构建期拼装注入)。 */
const describeTarget = injectWalker((sel, w) => {
    const el = document.querySelector(sel);
    return el === null ? null : w.describeElement(el);
});
/**
 * 策略引擎审批闸: 命中 auto 级别策略时经 confirmTool 弹审批等待用户决策,
 * 拒绝/超时抛错(调用方该步失败), 允许则返回继续执行原工具。
 * page 参数仅供测试注入; 缺省取当前活动页。
 */
export async function confirmGate(config, tool, args, page) {
    if (tool === "browser_confirm")
        return; // 审批本身不拦
    const hasPolicies = Array.isArray(config.confirmPolicies) && config.confirmPolicies.length > 0;
    if (config.confirmMode !== "auto" && !hasPolicies)
        return;
    const active = page !== undefined ? page : activePage();
    if (active === null || active === undefined)
        return;
    const sel = typeof args?.selector === "string" && args.selector
        ? args.selector
        : typeof args?.ref === "string" && args.ref
            ? (pageRef(active, args.ref)?.selector ?? "")
            : "";
    let desc = null;
    if (sel !== "") {
        try {
            desc = (await active.evaluate(describeTarget, sel));
        }
        catch {
            // 页面不可达/导航中: 交给原工具报错, 不因闸门误伤
        }
    }
    let url = "";
    try {
        url = active.url();
    }
    catch {
        /* ignore */
    }
    const decision = evaluatePolicy(config, {
        url,
        tool,
        selector: sel,
        desc,
    });
    if (decision.level !== "auto")
        return;
    const label = desc !== null && (desc.name || desc.text)
        ? `(${desc.role !== "" ? `${desc.role} ` : ""}"${desc.name || desc.text}")`
        : "";
    const reason = decision.reason
        ? `${decision.reason} ${label}`.trim()
        : `敏感操作审批: ${tool} 目标操作命中安全策略 ${label}`.trim();
    await confirmTool(config, {
        reason,
        tool,
        args,
        ...(decision.timeoutMs !== undefined ? { timeoutMs: decision.timeoutMs } : {}),
    });
}
//# sourceMappingURL=collaboration.js.map