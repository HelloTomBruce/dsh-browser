// dsh-browser · 客户端组件 — 敏感操作审批卡片
import { createElement } from "react";
export function ConfirmCard({ confirm, dark, onDecision }) {
    return createElement("div", {
        style: {
            padding: "6px 8px",
            borderRadius: "8px",
            border: "1px solid #ef4444",
            background: dark ? "rgba(239, 68, 68, 0.12)" : "rgba(239, 68, 68, 0.07)",
            color: dark ? "#fca5a5" : "#b91c1c",
            fontSize: "12px",
            lineHeight: "1.5",
        },
        title: "Agent 请求执行敏感操作,请审批",
    }, createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px" } }, createElement("span", { style: { flex: "none" } }, "⚠"), createElement("span", { style: { flex: 1, minWidth: 0, wordBreak: "break-all", fontWeight: 600 } }, "敏感操作待审批")), createElement("div", { style: { marginTop: "4px", wordBreak: "break-all" } }, confirm.reason, confirm.tool ? ` (${confirm.tool})` : ""), createElement("div", { style: { display: "flex", gap: "8px", marginTop: "6px" } }, createElement("button", {
        onClick: () => onDecision("allowed"),
        style: {
            flex: 1,
            padding: "4px 0",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            background: "#16a34a",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
        },
    }, "允许"), createElement("button", {
        onClick: () => onDecision("denied"),
        style: {
            flex: 1,
            padding: "4px 0",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            background: "#dc2626",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
        },
    }, "拒绝")));
}
//# sourceMappingURL=ConfirmCard.js.map