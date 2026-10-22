// dsh-browser · 客户端 — 浏览器状态与运行历史 Hook
import { useEffect, useState } from "react";
import { fetchLatestRun, fetchOperations, fetchStatus, triggerRerun } from "../api.js";
import type { BrowserOp, BrowserStatus, LatestRun } from "../types.js";

export function useBrowserStatus(base: string) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [ops, setOps] = useState<BrowserOp[]>([]);
  const [shotVersion, setShotVersion] = useState(Date.now());
  const [lastRun, setLastRun] = useState<LatestRun | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [rerunMsg, setRerunMsg] = useState("");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [newStatus, newOps, runInfo] = await Promise.all([
        fetchStatus(base),
        fetchOperations(base),
        fetchLatestRun(base),
      ]);
      if (!alive) return;
      setStatus(newStatus);
      if (newStatus?.open) setShotVersion(Date.now());
      setOps(newOps.slice(0, 8));
      setLastRun(runInfo.run);
      setAgentBusy(runInfo.busy);
    };

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [base]);

  const rerunLast = async () => {
    const run = lastRun;
    if (!run || agentBusy) return;
    const source = run.source.replace(/\(已从磁盘重载\)$/, "");
    if (!source || ["steps", "recording", "recent-log"].includes(source)) {
      setRerunMsg("该来源不是已保存录制,无法一键重跑");
      return;
    }
    setRerunMsg("重跑中…");
    setAgentBusy(true);

    const result = await triggerRerun(base, source, run.runId);
    if (result.ok) {
      setRerunMsg("重跑完成,报告稍后刷新");
    } else {
      setAgentBusy(false);
      setRerunMsg(result.error ?? "重跑失败");
    }
  };

  return {
    status,
    ops,
    shotVersion,
    lastRun,
    agentBusy,
    rerunMsg,
    rerunLast,
  };
}
