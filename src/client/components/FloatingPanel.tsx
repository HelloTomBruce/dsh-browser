// dsh-browser · 客户端组件 — 实时画面悬浮面板
import { createElement, type MouseEvent } from "react";
import type { BrowserOp, BrowserStatus, LatestRun, Palette, PendingConfirm, PendingPick } from "../types.js";
import { fmtTime } from "../theme.js";
import { ConfirmCard } from "./ConfirmCard.js";

interface FloatingPanelProps {
  status: BrowserStatus | null;
  ops: BrowserOp[];
  lastRun: LatestRun | null;
  agentBusy: boolean;
  rerunMsg: string;
  pendingConfirm: PendingConfirm | null;
  pendingPick?: PendingPick | null;
  shotSrc: string;
  streamSrc?: string;
  dark: boolean;
  palette: Palette;
  onOpenModal: () => void;
  onOpenReport: () => void;
  onConfirmDecision: (decision: "allowed" | "denied") => void;
  onRerunLast: () => void;
}

export function FloatingPanel({
  status,
  ops,
  lastRun,
  agentBusy,
  rerunMsg,
  pendingConfirm,
  pendingPick,
  shotSrc,
  streamSrc,
  dark,
  palette: p,
  onOpenModal,
  onOpenReport,
  onConfirmDecision,
  onRerunLast,
}: FloatingPanelProps) {
  return createElement(
    "div",
    {
      style: {
        position: "fixed",
        right: "16px",
        bottom: "68px",
        width: "320px",
        maxHeight: "78vh",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        border: `1px solid ${p.border}`,
        borderRadius: "12px",
        background: dark ? "#181e29" : "#ffffff",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
        padding: "12px",
        pointerEvents: "auto",
      },
    },
    // Status Row
    createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" } },
      createElement("span", {
        style: {
          width: "8px",
          height: "8px",
          borderRadius: "999px",
          flex: "none",
          background: status?.open ? "#10b981" : "#ef4444",
        },
      }),
      createElement(
        "span",
        {
          style: {
            flex: 1,
            minWidth: 0,
            color: p.primary,
            fontSize: "13px",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        },
        "浏览器实时画面",
      ),
      createElement(
        "span",
        {
          style: {
            color: p.secondary,
            fontSize: "12px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "160px",
          },
        },
        status === null
          ? "未启用"
          : status.open
            ? `${status.tabs ?? 1} 标签 · ${(status.url || "").slice(0, 20)}`
            : "未打开",
      ),
    ),
    // Sensitive-Action Approval Banner
    pendingConfirm
      ? createElement(ConfirmCard, {
          confirm: pendingConfirm,
          dark,
          onDecision: onConfirmDecision,
        })
      : null,
    // Human-Takeover Pause Banner
    status?.pause
      ? createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid #f59e0b",
              background: dark ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.08)",
              color: dark ? "#fbbf24" : "#b45309",
              fontSize: "12px",
              lineHeight: "1.5",
            },
            title: "Agent 正在等待人工操作,请在浏览器窗口中完成",
          },
          createElement("span", { style: { flex: "none" } }, "⏸"),
          createElement(
            "span",
            { style: { flex: 1, minWidth: 0, wordBreak: "break-all" } },
            `等待人工操作: ${status.pause.instruction}`,
          ),
        )
      : null,
    // Pick-Teaching Banner (browser_pick_element 等待中,点击缩略图放大去点选)
    pendingPick
      ? createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px dashed #f59e0b",
              background: dark ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.08)",
              color: dark ? "#fbbf24" : "#b45309",
              fontSize: "12px",
              lineHeight: "1.5",
              cursor: "pointer",
            },
            title: "点击放大实时画面,在画面上点选目标元素",
            onClick: onOpenModal,
          },
          createElement("span", { style: { flex: "none" } }, "🎯"),
          createElement(
            "span",
            { style: { flex: 1, minWidth: 0, wordBreak: "break-all" } },
            `等待点选教学: ${pendingPick.instruction}(点此放大画面)`,
          ),
        )
      : null,
    // Live Stream / Screenshot Thumbnail
    status?.open
      ? createElement("img", {
          src: streamSrc || shotSrc,
          onError: (e: any) => {
            if (e.currentTarget.src !== shotSrc) {
              e.currentTarget.src = shotSrc;
            }
          },
          alt: "实时画面",
          title: "点击放大查看实时大屏与访问历史",
          onClick: onOpenModal,
          style: {
            width: "100%",
            maxHeight: "160px",
            objectFit: "cover",
            borderRadius: "8px",
            border: `1px solid ${p.border}`,
            cursor: "pointer",
            background: dark ? "#10141c" : "#f8fafc",
          },
        })
      : createElement(
          "div",
          {
            style: {
              color: p.tertiary,
              fontSize: "11px",
              lineHeight: "1.5",
              padding: "8px",
              background: dark ? "#121620" : "#f8fafc",
              borderRadius: "6px",
            },
          },
          "浏览器尚未启动。在对话中让 Agent 调用 browser_open 即可呈现画面。",
        ),
    // Recent Operations
    ops.length > 0 &&
      createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            borderTop: `1px solid ${p.border}`,
            paddingTop: "6px",
            marginTop: "2px",
          },
        },
        createElement(
          "div",
          { style: { color: p.tertiary, fontSize: "11px", fontWeight: 500, marginBottom: "2px" } },
          `最近操作 (${ops.length} 条)`,
        ),
        ops.map((op, i) =>
          createElement(
            "div",
            {
              key: i,
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: p.secondary,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            },
            createElement(
              "span",
              {
                style: {
                  flex: "none",
                  color: op.ok ? "#10b981" : "#ef4444",
                  fontWeight: 600,
                },
              },
              op.ok ? "✓" : "✗",
            ),
            createElement("span", { style: { color: p.tertiary, fontSize: "11px", flex: "none" } }, fmtTime(op.ts)),
            createElement(
              "span",
              {
                style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
                title: `${op.tool}${op.error ? `: ${op.error}` : ""}`,
              },
              `${op.tool}${op.error ? `: ${op.error}` : ""}`,
            ),
          ),
        ),
      ),
    // 最近回归运行 (replay/batch)
    lastRun !== null &&
      createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            borderTop: `1px solid ${p.border}`,
            paddingTop: "6px",
            marginTop: "2px",
            fontSize: "12px",
            color: p.secondary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: "pointer",
          },
          title: `runId=${lastRun.runId} · 点击查看报告`,
          onClick: onOpenReport,
        },
        createElement("span", { style: { flex: "none", color: p.tertiary, fontSize: "11px" } }, "最近回归"),
        createElement(
          "span",
          {
            style: {
              flex: "none",
              fontWeight: 600,
              color: lastRun.failed === 0 ? "#10b981" : "#ef4444",
            },
          },
          lastRun.failed === 0 ? "✓" : "✗",
        ),
        createElement(
          "span",
          { style: { overflow: "hidden", textOverflow: "ellipsis" } },
          `${lastRun.source}${lastRun.row !== undefined ? ` 行${lastRun.row}` : ""} ${lastRun.passed}/${lastRun.total}${lastRun.healedCount > 0 ? ` · 自愈${lastRun.healedCount}` : ""}${lastRun.retries !== undefined && lastRun.retries.recovered > 0 ? ` · 重试挽回${lastRun.retries.recovered}` : ""} · ${new Date(lastRun.ts).toLocaleTimeString("zh-CN", { hour12: false })}`,
        ),
        rerunMsg !== "" &&
          createElement("span", { style: { flex: "none", color: p.tertiary, fontSize: "11px" } }, rerunMsg),
        createElement(
          "button",
          {
            type: "button",
            title: agentBusy ? "agent 忙碌,稍后可重跑" : `重跑 ${lastRun.source}(结果进运行历史,标 retryOf)`,
            disabled: agentBusy,
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              onRerunLast();
            },
            style: {
              flex: "none",
              height: "20px",
              padding: "0 8px",
              border: `1px solid ${p.border}`,
              borderRadius: "6px",
              background: "transparent",
              color: agentBusy ? p.tertiary : p.secondary,
              fontSize: "11px",
              cursor: agentBusy ? "not-allowed" : "pointer",
              opacity: agentBusy ? 0.5 : 1,
            },
          },
          agentBusy ? "重跑(忙碌)" : "↻ 重跑",
        ),
      ),
  );
}
