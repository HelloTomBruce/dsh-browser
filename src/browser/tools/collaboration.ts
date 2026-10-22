// dsh-browser · 浏览器工具 — 人机协同、等待人工与敏感操作审批
import type { Page } from "playwright-core";
import type { BrowserConfig } from "../types.js";
import {
  getPage, activePage, pageIdentity, pageRef,
  setPauseInstruction, clearPauseInstruction,
  setPendingConfirm, getPendingConfirm, clearPendingConfirm,
} from "../session.js";
import { injectWalker } from "../walker.js";
import { checkOnce, pollCondition, type TestCondition } from "./testing.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 操作预告高亮:agent 即将 click/type/select/press 的元素在页面上琥珀色描边
 * ~1.5 秒。异步不阻塞(fire-and-forget,任何失败静默),不影响操作时序。
 */
export function previewHighlight(page: Page | null, selector: string, label: string): void {
  if (page === null || selector === "") return;
  void page
    .evaluate(
      (arg: { selector: string; label: string }) => {
        const el = document.querySelector(arg.selector);
        if (el === null) return;
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
        } as Partial<CSSStyleDeclaration>);
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
        } as Partial<CSSStyleDeclaration>);
        tip.textContent = `agent: ${arg.label}`;
        box.appendChild(tip);
        document.documentElement.appendChild(box);
        setTimeout(() => {
          box.style.opacity = "0";
          setTimeout(() => box.remove(), 400);
        }, 1_200);
      },
      { selector, label },
    )
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
export async function waitForLoginTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  const startUrl = page.url();
  let condition: TestCondition;
  if (args.successSelector) {
    condition = { selector: String(args.successSelector), state: "visible" };
  } else if (args.successUrl) {
    condition = { url: String(args.successUrl) };
  } else {
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
export async function runPauseOnPage(
  page: Page,
  args: Record<string, any>,
): Promise<{ completed: boolean; waitedMs: number; detail: string }> {
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  if (!instruction) {
    throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
  }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 300_000) || 300_000, 1_000), 600_000);
  let startUrl = "";
  try {
    startUrl = page.url();
  } catch {
    /* 页面暂不可用(导航中/已关闭):交给轮询阶段统一记录 detail */
  }
  const startedAt = Date.now();
  const pageSignature = async (): Promise<string> => {
    try {
      return await page.evaluate(() => {
        const body = document.body;
        return `${location.href}|${body ? body.innerText.length : 0}|${document.querySelectorAll("input,button,a").length}`;
      });
    } catch {
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
        } else if (args.successUrl) {
          completed = new RegExp(String(args.successUrl)).test(page.url());
        } else {
          completed = page.url() !== startUrl || (await pageSignature()) !== startSig;
        }
      } catch (e) {
        completed = false;
        detail = `检查完成条件出错: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (completed) {
        detail = "人工操作完成";
        break;
      }
      await page.waitForTimeout(2_000);
    }
  } finally {
    clearPauseInstruction();
  }
  return { completed, waitedMs: Date.now() - startedAt, detail };
}

/** 人工接管等待工具入口(缺 instruction 在启动浏览器前即校验,失败更快)。 */
export async function pauseForHumanTool(config: BrowserConfig, args: Record<string, any>) {
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  if (!instruction) {
    throw new Error("缺少 instruction: 请说明需要人工完成什么操作(如「请输入短信验证码」)");
  }
  const page = await getPage(config);
  const result = await runPauseOnPage(page, args);
  return {
    completed: result.completed,
    status: result.completed ? ("completed" as const) : ("timedOut" as const),
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
export async function confirmTool(config: BrowserConfig, args: Record<string, any>) {
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!reason) {
    throw new Error("缺少 reason: 请说明要执行什么敏感操作、为什么需要审批(如「提交白名单表单,会产生线上数据变更」)");
  }
  const timeoutMs = Math.min(
    Math.max(Number(args.timeoutMs ?? config.confirmTimeoutMs ?? 60_000) || 60_000, 1_000),
    600_000,
  );
  const id = `cfm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: import("../session.js").PendingConfirm = {
    id,
    reason,
    tool: typeof args.tool === "string" && args.tool ? args.tool : undefined,
    args: args.args && typeof args.args === "object" ? args.args : undefined,
    startedAt: Date.now(),
  };
  setPendingConfirm(entry);
  const startedAt = Date.now();
  let decision: "allowed" | "denied" | "timeout" = "timeout";
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
  } finally {
    // 只有仍是本次请求时才清理(被取代时不动新请求)
    const pending = getPendingConfirm();
    if (pending !== null && pending.id === id) clearPendingConfirm();
  }
  if (decision !== "allowed") {
    throw new Error(`敏感操作被拒绝: ${reason} — ${detail}`);
  }
  return { decision, id, reason, waitedMs: Date.now() - startedAt, detail };
}

// ---------------------------------------------------------------------------
// F1 confirm 自动拦截(confirmMode: "auto",宿主层硬约束):
// sensitiveTools 工具执行前解析目标 selector/ref → 页内取元素统一描述
// (walker describeElement)→ 与 sensitivePatterns 子串匹配(大小写不敏感)
// → 命中即复用上面的审批管线(confirmTool,弹面板卡等待允许/拒绝/超时)。
// 未命中直接放行(一次页内 evaluate,与 preview 高亮同量级,无感知延迟)。
// ---------------------------------------------------------------------------

/** auto 模式默认敏感文本模式(提交/删除/支付类)。 */
export const DEFAULT_SENSITIVE_PATTERNS = ["提交", "删除", "支付"];

/** auto 模式默认参与判定的工具(已决:只拦 browser_click,type 误报率高)。 */
export const DEFAULT_SENSITIVE_TOOLS = ["browser_click"];

/** 敏感判定的元素描述(与 walker describeElement 字段子集对应)。 */
export interface SensitiveDesc {
  role: string;
  name: string;
  text: string;
  id: string;
  testid: string;
  tag: string;
}

/** 敏感判定的页内目标描述提取(walker 统一元素描述,构建期拼装注入)。 */
const describeTarget = injectWalker<string, SensitiveDesc | null>((sel, w) => {
  const el = document.querySelector(sel);
  return el === null ? null : (w.describeElement(el) as SensitiveDesc);
});

/**
 * 纯逻辑:元素描述命中了哪些敏感模式(role/name/text/id/testid/tag 拼接后
 * 子串匹配,大小写不敏感;空白模式忽略)。返回命中的模式列表(空 = 放行)。
 * 导出供测试。
 */
export function sensitiveHits(desc: SensitiveDesc | null, patterns: string[]): string[] {
  if (desc === null) return [];
  const hay = [desc.role, desc.name, desc.text, desc.id, desc.testid, desc.tag]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  if (hay === "") return [];
  return patterns.filter(
    (p) => typeof p === "string" && p.trim() !== "" && hay.includes(p.trim().toLowerCase()),
  );
}

/**
 * auto 模式审批闸:命中敏感模式时经 confirmTool 弹审批等待用户决策,
 * 拒绝/超时抛错(调用方该步失败),允许则返回继续执行原工具。
 * 不满足前置条件(非 auto / 工具不在 sensitiveTools / 无模式 / 无活动页 /
 * 无目标 selector / 页内取描述失败)一律直接放行,由原工具自行处理错误。
 * page 参数仅供测试注入;缺省取当前活动页。
 */
export async function confirmGate(
  config: BrowserConfig,
  tool: string,
  args: Record<string, any>,
  page?: Page | null,
): Promise<void> {
  if (config.confirmMode !== "auto") return;
  if (tool === "browser_confirm") return; // 审批本身不拦
  const tools = config.sensitiveTools ?? DEFAULT_SENSITIVE_TOOLS;
  if (!tools.includes(tool)) return;
  const patterns = config.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;
  if (patterns.length === 0) return;
  const active = page !== undefined ? page : activePage();
  if (active === null || active === undefined) return;
  const sel =
    typeof args?.selector === "string" && args.selector
      ? args.selector
      : typeof args?.ref === "string" && args.ref
        ? (pageRef(active, args.ref)?.selector ?? "")
        : "";
  if (sel === "") return; // 无目标 selector(如页面级按键):不拦
  let desc: SensitiveDesc | null = null;
  try {
    desc = (await active.evaluate(describeTarget, sel)) as SensitiveDesc | null;
  } catch {
    return; // 页面不可达/导航中:交给原工具报错,不因闸门误伤
  }
  const hits = sensitiveHits(desc, patterns);
  if (hits.length === 0) return;
  const label = desc !== null && (desc.name || desc.text) ? `(${desc.role !== "" ? `${desc.role} ` : ""}"${desc.name || desc.text}")` : "";
  await confirmTool(config, {
    reason: `confirmMode:auto 硬拦截:${tool} 目标元素命中敏感模式 [${hits.join(", ")}] ${label}`.trim(),
    tool,
    args,
  });
}
