// dsh-browser · 浏览器工具 — 人机协同、等待人工与敏感操作审批
import type { Page } from "playwright-core";
import type { BrowserConfig } from "../types.js";
import {
  getPage, activePage, pageIdentity, pageRef,
  setPauseInstruction, clearPauseInstruction,
  setPendingConfirm, getPendingConfirm, clearPendingConfirm,
  setPendingLoginWait, getPendingLoginWait, clearPendingLoginWait,
  setPendingPick, getPendingPick, clearPendingPick,
  pageRefsOf, setPageRefs, assignRefs,
  stateOf, registerTabPage, attachPage, profileConfig, currentProfile,
  isInteractivePanelPresent,
} from "../session.js";
import { screencastManager } from "../session/screencast.js";
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

export interface WaitForLoginResult {
  loggedIn: boolean;
  waitedMs: number;
  detail: string;
  targetPage: Page;
}

/**
 * 等待人工登录底层执行(独立导出供测试注入 fake page)。
 * 完成判定(按优先级):
 * 1. **用户主动告知(主通道)**:pendingLoginWait 单槽状态机,面板常驻登录等待卡
 *    「我已完成登录」按钮 → resolveLoginWait(id),500ms 确认节拍;
 * 2. 显式确定性条件:successSelector(任一存活标签可见)/ successUrl(URL 正则,
 *    任一存活标签命中),pollIntervalMs 节拍多标签扫描,命中即把目标页切为命中页;
 * 3. 超时返回 loggedIn:false(附 waitedMs 与 detail,不抛错)。
 *
 * 登录状态不再自动猜测:URL 认证特征/密码框消除/SPA 签名启发式对「登录表单
 * 隐藏不卸载(keep-alive/微前端)」「登录后 URL 仍含 auth 子串」的 SPA 会永久
 * 漏判(用户已登录仍空转到超时),已整体移除——登录完成由用户说了算。
 * 保留:存活标签感知(原标签关闭自愈迁移、新标签经 onNewPageDetected 注册)。
 */
export async function runWaitForLoginOnPage(
  initialPage: Page,
  args: Record<string, any>,
  onNewPageDetected?: (page: Page) => void,
): Promise<WaitForLoginResult> {
  const instruction =
    typeof args.instruction === "string" && args.instruction.trim()
      ? args.instruction.trim()
      : "请在浏览器窗口中完成登录";
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 120_000) || 120_000, 1_000), 600_000);
  const pollIntervalMs = Math.min(Math.max(Number(args.pollIntervalMs ?? 2_000) || 2_000, 100), 5_000);
  const successSelector = typeof args.successSelector === "string" ? args.successSelector : "";
  const successUrl = typeof args.successUrl === "string" ? args.successUrl : "";

  let currentPage = initialPage;
  const id = `login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  setPendingLoginWait({ id, instruction, startedAt: Date.now() });

  const startedAt = Date.now();
  let loggedIn = false;
  let detail = `等待登录超时(${timeoutMs}ms),用户未在面板确认登录完成`;
  let lastExplicitCheck = 0;

  try {
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      // 1. 用户主动告知(主通道,500ms 节拍)
      const pending = getPendingLoginWait();
      if (pending !== null && pending.id !== id) {
        // 被并发的新等待取代:本次退出,不误认新请求的确认
        detail = "登录等待已被新的等待请求取代";
        break;
      }
      if (pending !== null && pending.done) {
        loggedIn = true;
        detail = "用户已在面板确认完成登录";
        break;
      }

      // 2. 存活页面探测与自愈(显式条件扫描的目标集)
      let candidatePages: Page[] = [];
      try {
        const context = typeof currentPage.context === "function" ? currentPage.context() : null;
        if (context && typeof context.pages === "function") {
          candidatePages = context.pages().filter((p) => {
            try {
              return !p.isClosed();
            } catch {
              return false;
            }
          });
        }
      } catch {
        /* context 获取失败 */
      }

      let isCurrentClosed = false;
      try {
        isCurrentClosed = currentPage.isClosed();
      } catch {
        isCurrentClosed = true;
      }

      if (candidatePages.length > 0) {
        for (const p of candidatePages) {
          if (p !== currentPage && onNewPageDetected) {
            onNewPageDetected(p);
          }
        }
        if (isCurrentClosed) {
          currentPage = candidatePages[candidatePages.length - 1];
          isCurrentClosed = false;
        }
      }

      // 3. 显式确定性条件(pollIntervalMs 节拍,多标签扫描)
      if (
        (successSelector !== "" || successUrl !== "") &&
        Date.now() - lastExplicitCheck >= pollIntervalMs
      ) {
        lastExplicitCheck = Date.now();
        const targets = candidatePages.length > 0 ? candidatePages : isCurrentClosed ? [] : [currentPage];
        for (const p of targets) {
          try {
            if (successSelector !== "") {
              if (await p.locator(successSelector).first().isVisible()) {
                loggedIn = true;
                currentPage = p;
                detail = `命中 successSelector: ${successSelector}`;
                break;
              }
            } else if (new RegExp(successUrl).test(p.url())) {
              loggedIn = true;
              currentPage = p;
              detail = `命中 successUrl: ${successUrl}`;
              break;
            }
          } catch {
            /* 单页探测失败继续试下一页 */
          }
        }
      }

      if (loggedIn) break;
      try {
        await currentPage.waitForTimeout(500);
      } catch {
        await sleep(500);
      }
    }
  } finally {
    // 只有仍是本次请求时才清理(被取代时不动新请求)
    const pending = getPendingLoginWait();
    if (pending !== null && pending.id === id) clearPendingLoginWait();
  }

  return {
    loggedIn,
    waitedMs: Date.now() - startedAt,
    detail,
    targetPage: currentPage,
  };
}

/**
 * 等待人工登录完成(配合 headless:false 使用):agent 打开登录页后调用本工具,
 * 用户在浏览器窗口完成登录(输入/扫码/双因素)后,在实时画面面板的**常驻登录
 * 等待卡**上点「我已完成登录」主动告知,工具立即返回(500ms 确认节拍)。
 * 亦支持显式确定性条件 successSelector/successUrl(多标签扫描自动判定)。
 * 不做任何登录状态启发式猜测。超时返回 loggedIn:false(附 waitedMs 与
 * detail,不抛错)。无面板环境(MCP 独立模式)必须显式给条件,否则 fail-fast。
 */
export async function waitForLoginTool(config: BrowserConfig, args: Record<string, any>) {
  const hasExplicit =
    (typeof args.successSelector === "string" && args.successSelector !== "") ||
    (typeof args.successUrl === "string" && args.successUrl !== "");
  if (!isInteractivePanelPresent() && !hasExplicit) {
    throw new Error(
      "等待人工登录失败: 当前环境无交互面板,用户无法点「我已完成登录」确认。" +
        "请显式提供 successSelector(登录成功后出现的元素,如 \"#avatar\")或" +
        " successUrl(登录成功后 URL 应匹配的正则)后重试",
    );
  }
  const page = await getPage(config);
  const state = stateOf();
  const result = await runWaitForLoginOnPage(page, args, (newPage) => {
    if (![...state.pages.values()].includes(newPage)) {
      attachPage(newPage, profileConfig(config, currentProfile));
      registerTabPage(state, newPage);
    }
  });

  if (result.targetPage !== page) {
    for (const [id, p] of state.pages) {
      if (p === result.targetPage) {
        state.activeId = id;
        break;
      }
    }
  }

  const identity = await pageIdentity(result.targetPage);
  return {
    loggedIn: result.loggedIn,
    waitedMs: result.waitedMs,
    detail: result.detail,
    ...identity,
  };
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
  if (!isInteractivePanelPresent()) {
    throw new Error("敏感操作审批失败: 当前环境无前端面板支持人工审批(已按安全策略 fail-closed 拒绝)");
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
// 面板点选教学(browser_pick_element):agent 一句话说不清的疑难元素(画布/
// 哈希类名/深层 shadow DOM),让用户在实时画面大图上直接点一下。工具挂起等
// 待(面板轮询 GET /pick 显示十字光标),用户点击后前端把截图位图坐标 POST
// 回来,服务端按 CDP metadata 换算成视口 CSS 坐标 → elementFromPoint →
// walker describeElement 出统一描述与稳定 selector,并注册成正式 ref。
// 超时不抛错(pause 语义),返回 picked:false 由 agent 决定下一步。
// ---------------------------------------------------------------------------

/** 面板点选坐标 → 页面元素统一描述(walker 单一来源;elementFromPoint 向上爬到可交互元素)。 */
const describePoint = injectWalker<
  { x: number; y: number },
  | {
      role: string;
      name: string;
      selector: string;
      testid: string;
      id: string;
      tag: string;
      text: string;
      visible: boolean;
    }
  | null
>((payload, w) => {
  let el: Element | null = document.elementFromPoint(payload.x, payload.y);
  // shadow DOM retarget:命中点落在 open shadow 内容上时 elementFromPoint 返回
  // 宿主元素,需进入其 shadowRoot.elementFromPoint 逐层下潜取真实元素
  let dive = 0;
  while (el !== null && el.shadowRoot !== null && dive < 8) {
    const inner = el.shadowRoot.elementFromPoint(payload.x, payload.y);
    if (inner === null || inner === el) break;
    el = inner;
    dive += 1;
  }
  let hops = 0;
  while (el !== null && hops < 6) {
    const d = w.describeElement(el);
    if (w.INTERACTIVE.has(d.role)) return d;
    el = w.composedParent(el);
    hops += 1;
  }
  // 没爬到可交互元素(点在空白/纯展示区域):按未命中处理
  return null;
});

/**
 * 面板点选教学工具:等待用户在实时画面大图上点选目标元素,返回其统一描述、
 * 稳定 selector、选择器指纹(与录制自愈 healCandidates 兼容)与可直接使用
 * 的 ref。坐标换算:cssX = imgPx * viewportWidth / imgW / pageScaleFactor(elementFromPoint 收
 * 视口相对坐标,无需 scroll 换算)。
 * 导出 pickToolOnPage 供测试注入 fake page。
 */
export async function pickToolOnPage(
  page: Page,
  config: BrowserConfig,
  args: Record<string, any>,
): Promise<Record<string, any>> {
  const instruction =
    typeof args.instruction === "string" && args.instruction.trim() !== ""
      ? args.instruction.trim()
      : "请在实时画面大图上点击要教学的目标元素";
  if (!isInteractivePanelPresent()) {
    return {
      picked: false,
      status: "missed" as const,
      instruction,
      detail: "面板点选教学失败: 当前环境无前端面板供用户交互式点选",
      waitedMs: 0,
      ...(await pageIdentity(page)),
    };
  }
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 300_000) || 300_000, 1_000), 600_000);
  const id = `pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const meta = screencastManager.getLastFrame()?.metadata ?? undefined;
  const viewport = (() => {
    try {
      return page.viewportSize() ?? undefined;
    } catch {
      return undefined;
    }
  })();
  // CSS 坐标基准必须是 viewportSize(Playwright ground truth)。CDP metadata 的
  // deviceWidth/deviceHeight 是「捕获/缩放尺寸」——Chrome 对推流帧降采样时
  // 它等于帧尺寸而非视口(DSH 实测 1280 CSS 视口配 640×360 帧,导致换算
  // 恰好小一半),不能作基准;metadata 只取 pageScaleFactor(pinch 缩放修正),
  // viewportSize 不可得时才兜底用 metadata dims。
  const psf = Number(meta?.pageScaleFactor) > 0 ? Number(meta?.pageScaleFactor) : 1;
  const deviceWidth = viewport?.width ?? (Number(meta?.deviceWidth) || 0);
  const deviceHeight = viewport?.height ?? (Number(meta?.deviceHeight) || 0);
  setPendingPick({
    id,
    instruction,
    startedAt: Date.now(),
    ...(deviceWidth > 0 ? { deviceWidth } : {}),
    ...(deviceHeight > 0 ? { deviceHeight } : {}),
  });
  const startedAt = Date.now();
  let pick: { x: number; y: number; imgW: number; imgH: number } | undefined;
  let detail = `等待点选超时(${timeoutMs}ms)`;
  try {
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(500);
      const pending = getPendingPick();
      if (pending === null || pending.id !== id) {
        detail = "点选请求已被新请求取代";
        break;
      }
      if (pending.pick !== undefined) {
        pick = pending.pick;
        detail = "用户已点选";
        break;
      }
    }
  } finally {
    const pending = getPendingPick();
    if (pending !== null && pending.id === id) clearPendingPick();
  }
  const waitedMs = Date.now() - startedAt;
  if (pick === undefined) {
    return { picked: false, status: "timedOut", instruction, detail, waitedMs };
  }
  if (deviceWidth <= 0 || deviceHeight <= 0 || pick.imgW <= 0 || pick.imgH <= 0) {
    return { picked: false, status: "missed", instruction, detail: "缺少推流帧尺寸元数据,无法换算坐标(请确认实时画面已启动)", waitedMs };
  }
  const cssX = Math.round((pick.x * deviceWidth) / pick.imgW / psf);
  const cssY = Math.round((pick.y * deviceHeight) / pick.imgH / psf);
  let desc: ReturnType<typeof describePoint> = null;
  try {
    desc = await page.evaluate(describePoint, { x: cssX, y: cssY });
  } catch {
    desc = null;
  }
  if (desc === null || desc.selector === "") {
    return {
      picked: false,
      status: "missed",
      instruction,
      detail: `坐标 (${cssX}, ${cssY}) 处未命中可交互元素(可能点在空白区域或纯展示元素上)`,
      waitedMs,
    };
  }
  // 注册成正式 ref:agent 拿到结果可直接 browser_click { ref }
  const { withRefs, merged } = assignRefs(pageRefsOf(page), [
    { role: desc.role, name: desc.name, selector: desc.selector, ancestors: [] },
  ], 500);
  setPageRefs(page, merged);
  const ref = withRefs[0]?.ref;
  return {
    picked: true,
    status: "picked",
    instruction,
    detail,
    waitedMs,
    ...(ref !== undefined ? { ref } : {}),
    selector: desc.selector,
    role: desc.role,
    name: desc.name,
    tag: desc.tag,
    ...(desc.testid !== "" ? { testid: desc.testid } : {}),
    ...(desc.id !== "" ? { elementId: desc.id } : {}),
    ...(desc.text !== "" ? { text: desc.text } : {}),
    hint: {
      ...(desc.testid !== "" ? { testid: desc.testid } : {}),
      ...(desc.role !== "" ? { role: desc.role } : {}),
      ...(desc.name !== "" ? { name: desc.name } : {}),
      ...(desc.id !== "" ? { id: desc.id } : {}),
      ...(desc.text !== "" ? { text: desc.text } : {}),
      tag: desc.tag,
    },
    x: cssX,
    y: cssY,
    map: {
      viewport: { w: deviceWidth, h: deviceHeight },
      img: { w: pick.imgW, h: pick.imgH },
      ...(meta?.deviceWidth !== undefined ? { cdpFrame: { w: Number(meta.deviceWidth) || 0, h: Number(meta.deviceHeight) || 0 } } : {}),
      pageScaleFactor: psf,
    },
    ...(await pageIdentity(page)),
  };
}

/** 面板点选教学工具入口。 */
export async function pickTool(config: BrowserConfig, args: Record<string, any>) {
  const page = await getPage(config);
  return pickToolOnPage(page, config, args);
}

// ---------------------------------------------------------------------------
// F1 confirm 自动拦截(confirmMode: "auto" 或 confirmPolicies 多维策略引擎):
// sensitiveTools / 策略链在工具执行前解析目标 selector/ref → 页内取元素统一描述
// (walker describeElement) → 策略规则链判定
// → 命中即复用审批管线(confirmTool, 弹面板卡等待允许/拒绝/超时)。
// 未命中直接放行(一次页内 evaluate, 与 preview 高亮同量级, 无感知延迟)。
// ---------------------------------------------------------------------------

import {
  evaluatePolicy,
  sensitiveHits,
  DEFAULT_SENSITIVE_PATTERNS,
  DEFAULT_SENSITIVE_TOOLS,
  type SensitiveDesc,
} from "../policy/engine.js";

export { sensitiveHits, DEFAULT_SENSITIVE_PATTERNS, DEFAULT_SENSITIVE_TOOLS, type SensitiveDesc };

/** 敏感判定的页内目标描述提取(walker 统一元素描述,构建期拼装注入)。 */
const describeTarget = injectWalker<string, SensitiveDesc | null>((sel, w) => {
  const el = document.querySelector(sel);
  return el === null ? null : (w.describeElement(el) as SensitiveDesc);
});

/**
 * 策略引擎审批闸: 命中 auto 级别策略时经 confirmTool 弹审批等待用户决策,
 * 拒绝/超时抛错(调用方该步失败), 允许则返回继续执行原工具。
 * page 参数仅供测试注入; 缺省取当前活动页。
 */
export async function confirmGate(
  config: BrowserConfig,
  tool: string,
  args: Record<string, any>,
  page?: Page | null,
): Promise<void> {
  if (tool === "browser_confirm") return; // 审批本身不拦
  const hasPolicies = Array.isArray(config.confirmPolicies) && config.confirmPolicies.length > 0;
  if (config.confirmMode !== "auto" && !hasPolicies) return;

  const active = page !== undefined ? page : activePage();
  if (active === null || active === undefined) return;

  const sel =
    typeof args?.selector === "string" && args.selector
      ? args.selector
      : typeof args?.ref === "string" && args.ref
        ? (pageRef(active, args.ref)?.selector ?? "")
        : "";

  let desc: SensitiveDesc | null = null;
  if (sel !== "") {
    try {
      desc = (await active.evaluate(describeTarget, sel)) as SensitiveDesc | null;
    } catch {
      // 页面不可达/导航中: 交给原工具报错, 不因闸门误伤
    }
  }

  let url = "";
  try {
    url = active.url();
  } catch {
    /* ignore */
  }

  const decision = evaluatePolicy(config, {
    url,
    tool,
    selector: sel,
    desc,
  });

  if (decision.level !== "auto") return;

  const label =
    desc !== null && (desc.name || desc.text)
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
