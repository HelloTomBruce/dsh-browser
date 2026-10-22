// dsh-browser · 客户端组件 — 设置页录制管理器
import type { SettingsSectionOwnerProps } from "@deepseek-ai/dsh-client-ui-settings/client";
import { createElement, useEffect, useState } from "react";
import { getBasePath } from "../api.js";
import { useRecordings } from "../hooks/useRecordings.js";
import { DARK, LIGHT, useDarkTheme } from "../theme.js";
import { styleFor } from "./styles.js";

export function BrowserSettingsSection(_props: SettingsSectionOwnerProps) {
  const dark = useDarkTheme();
  const p = dark ? DARK : LIGHT;
  const S = styleFor(p);
  const [base, setBase] = useState<string>("/browser");

  useEffect(() => {
    let alive = true;
    getBasePath().then((b) => {
      if (alive) setBase(b.replace(/\/+$/, ""));
    });
    return () => {
      alive = false;
    };
  }, []);

  const { list, error, expanded, toggleDetail, remove } = useRecordings(base);

  return createElement(
    "div",
    { style: S.root },
    // Modern Settings Header with Browser Icon
    createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "12px",
          paddingBottom: "12px",
          marginBottom: "6px",
          borderBottom: `1px solid ${p.border}`,
        },
      },
      createElement(
        "div",
        {
          style: {
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: dark ? "rgba(99, 102, 241, 0.15)" : "rgba(99, 102, 241, 0.1)",
            border: `1px solid ${dark ? "rgba(99, 102, 241, 0.3)" : "rgba(99, 102, 241, 0.2)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
            flex: "none",
          },
        },
        "🌐",
      ),
      createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "2px" } },
        createElement(
          "div",
          { style: { fontSize: "15px", fontWeight: 600, color: p.primary } },
          "浏览器自动化与录制管理",
        ),
        createElement(
          "div",
          { style: { fontSize: "12px", color: p.tertiary } },
          "管理已保存的浏览器回归脚本，查看执行序列与历史数据",
        ),
      ),
    ),
    createElement(
      "div",
      { style: S.heading },
      "已保存的录制（由 browser_record save 生成，供 browser_replay 一键回放）：",
    ),
    error
      ? createElement("div", { style: { ...S.empty, color: p.danger } }, `加载失败: ${error}`)
      : list === null
        ? createElement("div", { style: S.empty }, "加载中…")
        : list.length === 0
          ? createElement(
              "div",
              { style: S.empty },
              "暂无已保存录制。在与 Agent 对话中完成一轮浏览器操作后，输入「保存录制为 xxx」即可沉淀为回归用例。",
            )
          : list.map((row) => {
              const detail = expanded[row.name];
              const isExpanded = detail !== undefined && detail !== "loading";
              return createElement(
                "div",
                { key: row.name, style: S.itemBox },
                createElement(
                  "div",
                  { style: S.row },
                  createElement(
                    "span",
                    {
                      style: S.label,
                      title: "点击展开 / 折叠步骤详情",
                      onClick: () => toggleDetail(row.name),
                    },
                    (isExpanded ? "▾ " : "▸ ") + row.name,
                  ),
                  createElement(
                    "span",
                    { style: S.meta },
                    `${row.steps} 步 · ${new Date(row.savedAt).toLocaleDateString("zh-CN")}`,
                  ),
                  createElement(
                    "button",
                    {
                      type: "button",
                      style: S.btn,
                      onClick: () => toggleDetail(row.name),
                    },
                    isExpanded ? "收起" : "步骤",
                  ),
                  createElement(
                    "button",
                    {
                      type: "button",
                      style: S.delBtn,
                      onClick: () => remove(row.name),
                    },
                    "删除",
                  ),
                ),
                isExpanded &&
                  detail !== "failed" &&
                  createElement(
                    "div",
                    { style: S.stepsBox },
                    detail.steps.map((st, i) =>
                      createElement(
                        "div",
                        { key: i, style: S.stepLine },
                        createElement("span", { style: S.meta }, `#${i + 1}`),
                        createElement("span", { style: S.toolName }, st.tool),
                        createElement("span", { style: S.stepArgs }, JSON.stringify(st.args)),
                      ),
                    ),
                  ),
              );
            }),
  );
}
