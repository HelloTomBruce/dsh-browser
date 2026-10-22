// dsh-browser · 客户端 — 样式定义
import type React from "react";
import type { Palette } from "../types.js";

export function styleFor(p: Palette) {
  return {
    row: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      minWidth: 0,
    } as React.CSSProperties,
    label: {
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: "13px",
      color: p.primary,
      cursor: "pointer",
    } as React.CSSProperties,
    meta: {
      color: p.tertiary,
      fontSize: "12px",
      whiteSpace: "nowrap",
    } as React.CSSProperties,
    btn: {
      height: "24px",
      padding: "0 10px",
      border: `1px solid ${p.border}`,
      borderRadius: "6px",
      background: "transparent",
      color: p.secondary,
      font: "inherit",
      fontSize: "12px",
      cursor: "pointer",
    } as React.CSSProperties,
    delBtn: {
      height: "24px",
      padding: "0 10px",
      border: `1px solid ${p.border}`,
      borderRadius: "6px",
      background: "transparent",
      color: p.danger,
      font: "inherit",
      fontSize: "12px",
      cursor: "pointer",
    } as React.CSSProperties,
    itemBox: {
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      border: `1px solid ${p.border}`,
      borderRadius: "8px",
      padding: "8px 10px",
    } as React.CSSProperties,
    stepsBox: {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      borderTop: `1px solid ${p.border}`,
      paddingTop: "6px",
    } as React.CSSProperties,
    stepLine: {
      display: "flex",
      gap: "8px",
      fontSize: "13px",
      lineHeight: "1.7",
      color: p.secondary,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    } as React.CSSProperties,
    toolName: {
      color: p.primary,
      flex: "none",
      fontWeight: 500,
    } as React.CSSProperties,
    stepArgs: {
      flex: 1,
      minWidth: 0,
      overflow: "hidden",
      textOverflow: "ellipsis",
      color: p.secondary,
    } as React.CSSProperties,
    empty: {
      color: p.tertiary,
      fontSize: "12px",
      textAlign: "center",
      padding: "12px 0",
    } as React.CSSProperties,
    root: {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      maxWidth: "720px",
    } as React.CSSProperties,
    heading: {
      color: p.tertiary,
      fontSize: "12px",
      lineHeight: "1.6",
    } as React.CSSProperties,
  };
}
