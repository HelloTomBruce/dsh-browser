// dsh-browser · 客户端 — 主题调色板与工具函数
import { useEffect, useState } from "react";
import type { Palette } from "./types.js";

export const LIGHT: Palette = {
  primary: "#1f2937",
  secondary: "#4b5563",
  tertiary: "#6b7280",
  border: "#d8dde3",
  hoverBg: "#f1f4f7",
  danger: "#dc2626",
};

export const DARK: Palette = {
  primary: "#f3f4f6",
  secondary: "#cbd5e1",
  tertiary: "#94a3b8",
  border: "#3f4a58",
  hoverBg: "#2a3240",
  danger: "#f87171",
};

/** 跟随宿主主题 (body[data-ds-dark-theme]) */
export function useDarkTheme(): boolean {
  const [dark, setDark] = useState<boolean>(
    () => typeof document !== "undefined" && document.body?.getAttribute("data-ds-dark-theme") !== null,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = (): void => setDark(document.body?.getAttribute("data-ds-dark-theme") !== null);
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = ("0" + d.getHours()).slice(-2);
  const mm = ("0" + d.getMinutes()).slice(-2);
  return `${hh}:${mm}`;
}
