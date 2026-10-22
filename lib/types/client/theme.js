// dsh-browser · 客户端 — 主题调色板与工具函数
import { useEffect, useState } from "react";
export const LIGHT = {
    primary: "#1f2937",
    secondary: "#4b5563",
    tertiary: "#6b7280",
    border: "#d8dde3",
    hoverBg: "#f1f4f7",
    danger: "#dc2626",
};
export const DARK = {
    primary: "#f3f4f6",
    secondary: "#cbd5e1",
    tertiary: "#94a3b8",
    border: "#3f4a58",
    hoverBg: "#2a3240",
    danger: "#f87171",
};
/** 跟随宿主主题 (body[data-ds-dark-theme]) */
export function useDarkTheme() {
    const [dark, setDark] = useState(() => typeof document !== "undefined" && document.body?.getAttribute("data-ds-dark-theme") !== null);
    useEffect(() => {
        if (typeof document === "undefined")
            return;
        const sync = () => setDark(document.body?.getAttribute("data-ds-dark-theme") !== null);
        const obs = new MutationObserver(sync);
        obs.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
        return () => obs.disconnect();
    }, []);
    return dark;
}
export function fmtTime(ts) {
    const d = new Date(ts);
    const hh = ("0" + d.getHours()).slice(-2);
    const mm = ("0" + d.getMinutes()).slice(-2);
    return `${hh}:${mm}`;
}
//# sourceMappingURL=theme.js.map