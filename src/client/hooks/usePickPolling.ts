// dsh-browser · 客户端 — 面板点选教学轮询 Hook
// 克隆 useConfirmPolling 的自适应退避模式(正常 1s,连续 3 次失败退 15s)。
import { useEffect, useState } from "react";
import { fetchPendingPick } from "../api.js";
import type { PendingPick } from "../types.js";

export function usePickPolling(base: string) {
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);

  useEffect(() => {
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const item = await fetchPendingPick(base);
        if (!alive) return;
        failures = 0;
        setPendingPick(item);
      } catch {
        failures++;
        if (alive) setPendingPick(null);
      } finally {
        if (!alive) return;
        const nextDelay = failures >= 3 ? 15_000 : 1_000;
        timer = setTimeout(poll, nextDelay);
      }
    };

    poll();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [base]);

  return { pendingPick };
}
