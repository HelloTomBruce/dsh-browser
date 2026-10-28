// dsh-browser · 客户端组件 — 悬浮总控组件 (FAB + Panel + Modals)
import { createElement, useEffect, useState } from "react";
import { fetchHistory, getBasePath, submitPick } from "../api.js";
import { useBrowserStatus } from "../hooks/useBrowserStatus.js";
import { useConfirmPolling } from "../hooks/useConfirmPolling.js";
import { useLoginWaitPolling } from "../hooks/useLoginWaitPolling.js";
import { usePickPolling } from "../hooks/usePickPolling.js";
import { DARK, LIGHT, useDarkTheme } from "../theme.js";
import type { NavHistoryItem } from "../types.js";
import { FloatingPanel } from "./FloatingPanel.js";
import { InspectionModal, ReportModal } from "./InspectionModal.js";
import { LoginWaitCard } from "./LoginWaitCard.js";

export function BrowserFloatingOverlay() {
  const dark = useDarkTheme();
  const p = dark ? DARK : LIGHT;
  const [base, setBase] = useState<string>("/browser");
  const [isOpen, setIsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [history, setHistory] = useState<NavHistoryItem[]>([]);

  // Discover node-half base path
  useEffect(() => {
    let alive = true;
    getBasePath().then((b) => {
      if (alive) setBase(b.replace(/\/+$/, ""));
    });
    return () => {
      alive = false;
    };
  }, []);

  const { status, ops, shotVersion, lastRun, agentBusy, rerunMsg, rerunLast } = useBrowserStatus(base);
  const { pendingConfirm, resolveConfirm } = useConfirmPolling(base);
  const { loginWait, confirmLoginDone } = useLoginWaitPolling(base);
  const { pendingPick } = usePickPolling(base);

  // Poll navigation history when modal is open
  useEffect(() => {
    if (!modalOpen) return;
    let alive = true;
    const pollHistory = async () => {
      const items = await fetchHistory(base);
      if (alive) setHistory(items);
    };
    pollHistory();
    const timer = setInterval(pollHistory, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [modalOpen, base]);

  const shotSrc = `${base}/screenshot?v=${shotVersion}`;
  const streamSrc = `${base}/stream`;

  return createElement(
    "div",
    {
      id: "dsh-browser-client-overlay",
      style: {
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2147483000,
      },
    },
    // 登录等待卡(常驻悬浮,不依赖面板展开——用户在浏览器窗口登录时可能没展开 DSH 面板)
    loginWait && !loginWait.done
      ? createElement(LoginWaitCard, {
          loginWait,
          onDone: () => {
            void confirmLoginDone(loginWait.id);
          },
        })
      : null,
    // FAB Floating Button
    createElement(
      "button",
      {
        type: "button",
        title: "浏览器自动化与实时画面",
        onClick: () => setIsOpen((v) => !v),
        style: {
          position: "fixed",
          right: "16px",
          bottom: "16px",
          width: "42px",
          height: "42px",
          borderRadius: "999px",
          border: `1px solid ${p.border}`,
          background: dark ? "#1e2430" : "#ffffff",
          color: p.primary,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "18px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
          transition: "transform 0.15s ease, background 0.15s ease",
          pointerEvents: "auto",
        },
      },
      "🌐",
    ),
    // Floating Panel
    isOpen &&
      createElement(FloatingPanel, {
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
        onOpenModal: () => setModalOpen(true),
        onOpenReport: () => setReportOpen(true),
        onConfirmDecision: (decision) => {
          if (pendingConfirm) resolveConfirm(pendingConfirm.id, decision);
        },
        onRerunLast: rerunLast,
      }),
    // Full-screen Modal Box
    modalOpen &&
      createElement(InspectionModal, {
        status,
        history,
        shotSrc,
        streamSrc,
        dark,
        palette: p,
        onClose: () => setModalOpen(false),
        pendingPick,
        onPick: (x, y, imgW, imgH) => {
          if (pendingPick) void submitPick(base, pendingPick.id, x, y, imgW, imgH);
        },
      }),
    // Regression Report Modal
    reportOpen &&
      createElement(ReportModal, {
        base,
        dark,
        palette: p,
        onClose: () => setReportOpen(false),
      }),
  );
}
