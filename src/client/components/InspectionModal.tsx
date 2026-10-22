// dsh-browser · 客户端组件 — 实时画面全屏模态框与访问历史
import { createElement, useEffect, type MouseEvent } from "react";
import type { NavHistoryItem, Palette, BrowserStatus } from "../types.js";
import { fmtTime } from "../theme.js";

interface InspectionModalProps {
  status: BrowserStatus | null;
  history: NavHistoryItem[];
  shotSrc: string;
  dark: boolean;
  palette: Palette;
  onClose: () => void;
}

export function InspectionModal({
  status,
  history,
  shotSrc,
  dark,
  palette: p,
  onClose,
}: InspectionModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createElement(
    "div",
    {
      onClick: (e: MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      },
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 2147483001,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(0, 0, 0, 0.65)",
        pointerEvents: "auto",
      },
    },
    createElement(
      "div",
      {
        style: {
          width: "min(1100px, 94vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          border: `1px solid ${p.border}`,
          borderRadius: "12px",
          background: dark ? "#181e29" : "#ffffff",
          padding: "16px",
          boxShadow: "0 16px 64px rgba(0, 0, 0, 0.4)",
        },
      },
      // Header
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        createElement(
          "span",
          {
            style: {
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: p.primary,
              fontSize: "14px",
              fontWeight: 600,
            },
          },
          status?.open ? `${status.title || ""} (${status.url || ""})` : "浏览器实时大屏",
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: onClose,
            style: {
              width: "28px",
              height: "28px",
              border: `1px solid ${p.border}`,
              borderRadius: "6px",
              background: "transparent",
              color: p.secondary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
            },
          },
          "✕",
        ),
      ),
      // Large Screenshot
      status?.open
        ? createElement("img", {
            src: shotSrc,
            alt: "浏览器大图",
            style: {
              width: "100%",
              maxHeight: "55vh",
              objectFit: "contain",
              borderRadius: "8px",
              border: `1px solid ${p.border}`,
              background: dark ? "#10141c" : "#f8fafc",
            },
          })
        : createElement(
            "div",
            {
              style: {
                color: p.tertiary,
                fontSize: "13px",
                textAlign: "center",
                padding: "32px 0",
              },
            },
            "浏览器尚未打开",
          ),
      // History Section
      history.length > 0 &&
        createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              maxHeight: "22vh",
              overflowY: "auto",
              borderTop: `1px solid ${p.border}`,
              paddingTop: "8px",
            },
          },
          createElement(
            "div",
            { style: { color: p.tertiary, fontSize: "12px", fontWeight: 500 } },
            `访问历史 (${history.length} 条，点击在新标签打开)`,
          ),
          history.map((h, i) =>
            createElement(
              "a",
              {
                key: i,
                href: h.url,
                target: "_blank",
                rel: "noopener noreferrer",
                style: {
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  color: p.secondary,
                  fontSize: "12px",
                  textDecoration: "none",
                  borderRadius: "6px",
                  padding: "4px 6px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
              },
              createElement("span", { style: { color: p.tertiary, flex: "none" } }, fmtTime(h.ts)),
              createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, h.title || h.url),
            ),
          ),
        ),
    ),
  );
}

interface ReportModalProps {
  base: string;
  dark: boolean;
  palette: Palette;
  onClose: () => void;
}

export function ReportModal({ base, dark, palette: p, onClose }: ReportModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createElement(
    "div",
    {
      onClick: (e: MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
      },
      style: {
        position: "fixed",
        inset: 0,
        zIndex: 2147483002,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(0, 0, 0, 0.65)",
        pointerEvents: "auto",
      },
    },
    createElement(
      "div",
      {
        style: {
          width: "min(1000px, 94vw)",
          height: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          border: `1px solid ${p.border}`,
          borderRadius: "12px",
          background: dark ? "#181e29" : "#ffffff",
          padding: "16px",
          boxShadow: "0 16px 64px rgba(0, 0, 0, 0.4)",
        },
      },
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "8px" } },
        createElement(
          "span",
          {
            style: {
              flex: 1,
              minWidth: 0,
              color: p.primary,
              fontSize: "14px",
              fontWeight: 600,
            },
          },
          "回归测试报告 (最新运行)",
        ),
        createElement(
          "a",
          {
            href: `${base}/runs/report.html`,
            target: "_blank",
            rel: "noopener noreferrer",
            style: {
              color: p.secondary,
              fontSize: "12px",
              textDecoration: "none",
              padding: "4px 8px",
              border: `1px solid ${p.border}`,
              borderRadius: "6px",
            },
          },
          "新标签页打开",
        ),
        createElement(
          "button",
          {
            type: "button",
            onClick: onClose,
            style: {
              width: "28px",
              height: "28px",
              border: `1px solid ${p.border}`,
              borderRadius: "6px",
              background: "transparent",
              color: p.secondary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
            },
          },
          "✕",
        ),
      ),
      createElement("iframe", {
        src: `${base}/runs/report.html`,
        title: "回归测试报告",
        style: {
          flex: 1,
          width: "100%",
          border: `1px solid ${p.border}`,
          borderRadius: "8px",
          background: "#ffffff",
        },
      }),
    ),
  );
}
