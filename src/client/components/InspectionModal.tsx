// dsh-browser · 客户端组件 — 实时画面全屏模态框与访问历史
import { createElement, useEffect, type MouseEvent } from "react";
import type { NavHistoryItem, Palette, BrowserStatus, PendingPick } from "../types.js";
import { fmtTime } from "../theme.js";

interface InspectionModalProps {
  status: BrowserStatus | null;
  history: NavHistoryItem[];
  shotSrc: string;
  streamSrc?: string;
  dark: boolean;
  palette: Palette;
  onClose: () => void;
  /** 面板点选教学:等待中非空,大图切换为十字光标点选模式。 */
  pendingPick?: PendingPick | null;
  /** 用户点选回调(x/y 为截图位图像素坐标,imgW/imgH 为截图尺寸)。 */
  onPick?: (x: number, y: number, imgW: number, imgH: number) => void;
}

export function InspectionModal({
  status,
  history,
  shotSrc,
  streamSrc,
  dark,
  palette: p,
  onClose,
  pendingPick,
  onPick,
}: InspectionModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** objectFit: contain 的 letterbox 几何:显示盒坐标 → 位图像素坐标。 */
  const handleImageClick = (e: MouseEvent<HTMLImageElement>) => {
    if (pendingPick === null || pendingPick === undefined || onPick === undefined) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const nw = img.naturalWidth || rect.width;
    const nh = img.naturalHeight || rect.height;
    if (nw <= 0 || nh <= 0) return;
    const scale = Math.min(rect.width / nw, rect.height / nh);
    const ox = (rect.width - nw * scale) / 2;
    const oy = (rect.height - nh * scale) / 2;
    const px = Math.min(Math.max((e.clientX - rect.left - ox) / scale, 0), nw);
    const py = Math.min(Math.max((e.clientY - rect.top - oy) / scale, 0), nh);
    onPick(Math.round(px), Math.round(py), Math.round(nw), Math.round(nh));
  };

  const picking = pendingPick !== null && pendingPick !== undefined;

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
      // Pick-teaching banner (browser_pick_element 等待中)
      picking
        ? createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px dashed #f59e0b",
                background: dark ? "rgba(245, 158, 11, 0.12)" : "rgba(245, 158, 11, 0.08)",
                color: dark ? "#fbbf24" : "#b45309",
                fontSize: "12px",
                lineHeight: "1.5",
              },
            },
            createElement("span", { style: { flex: "none" } }, "🎯"),
            createElement(
              "span",
              { style: { flex: 1, minWidth: 0, wordBreak: "break-all" } },
              `等待点选教学: ${pendingPick.instruction}(在下方画面上点击目标元素)`,
            ),
          )
        : null,
      // Large Live Stream / Screenshot
      status?.open
        ? createElement("img", {
            src: streamSrc || shotSrc,
            onError: (e: any) => {
              if (e.currentTarget.src !== shotSrc) {
                e.currentTarget.src = shotSrc;
              }
            },
            alt: "浏览器大图",
            ...(picking ? { onClick: handleImageClick } : {}),
            style: {
              width: "100%",
              maxHeight: "55vh",
              objectFit: "contain",
              borderRadius: "8px",
              border: picking ? "2px dashed #f59e0b" : `1px solid ${p.border}`,
              background: dark ? "#10141c" : "#f8fafc",
              cursor: picking ? "crosshair" : "default",
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
