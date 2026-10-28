// dsh-browser · 客户端 — 等待人工登录轮询 Hook(browser_wait_for_login 等待期间,
// 常驻登录卡展示提示并轮询,用户点「我已完成登录」提交确认)
import { useEffect, useState } from "react";
import { fetchPendingLoginWait, submitLoginDone } from "../api.js";
import type { PendingLoginWait } from "../types.js";

export function useLoginWaitPolling(base: string) {
  const [loginWait, setLoginWait] = useState<PendingLoginWait | null>(null);

  useEffect(() => {
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const item = await fetchPendingLoginWait(base);
        if (!alive) return;
        failures = 0;
        setLoginWait(item);
      } catch {
        failures++;
        if (alive) setLoginWait(null);
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

  const confirmLoginDone = async (id: string) => {
    const ok = await submitLoginDone(base, id);
    if (ok) {
      setLoginWait(null);
    }
  };

  return { loginWait, confirmLoginDone };
}
