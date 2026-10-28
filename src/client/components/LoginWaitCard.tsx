// dsh-browser · 客户端组件 — 等待人工登录卡片(常驻悬浮,不依赖面板展开)
import { createElement } from "react";
import type { PendingLoginWait } from "../types.js";

interface LoginWaitCardProps {
  loginWait: PendingLoginWait;
  onDone: () => void;
}

/**
 * browser_wait_for_login 等待期间常驻悬浮于 FAB 上方(面板收起也可见):
 * 用户此时在浏览器窗口里登录,可能不看 DSH 面板,卡片必须始终露出。
 * 「我已完成登录」→ POST /browser/login → 工具立即返回 loggedIn:true。
 */
export function LoginWaitCard({ loginWait, onDone }: LoginWaitCardProps) {
  return createElement(
    "div",
    {
      style: {
        position: "fixed",
        right: "16px",
        bottom: "68px",
        width: "260px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: "1px solid #16a34a",
        background: "rgba(22, 163, 74, 0.12)",
        color: "#15803d",
        fontSize: "12px",
        lineHeight: "1.5",
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.18)",
        pointerEvents: "auto",
      },
      title: "Agent 正在等待你完成登录:请在浏览器窗口登录后点击下方按钮",
    },
    createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "6px" } },
      createElement("span", { style: { flex: "none" } }, "🔐"),
      createElement(
        "span",
        { style: { flex: 1, minWidth: 0, fontWeight: 600, wordBreak: "break-all" } },
        "等待人工登录",
      ),
    ),
    createElement(
      "div",
      { style: { marginTop: "4px", wordBreak: "break-all", opacity: 0.9 } },
      loginWait.instruction,
    ),
    createElement(
      "button",
      {
        onClick: onDone,
        style: {
          width: "100%",
          marginTop: "8px",
          padding: "6px 0",
          borderRadius: "6px",
          border: "none",
          cursor: "pointer",
          background: "#16a34a",
          color: "#fff",
          fontSize: "13px",
          fontWeight: 600,
        },
      },
      "我已完成登录",
    ),
  );
}
