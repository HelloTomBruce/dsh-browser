// dsh-browser · 客户端 — 敏感操作审批轮询 Hook
import { useEffect, useState } from "react";
import { fetchPendingConfirm, submitConfirmDecision } from "../api.js";
export function useConfirmPolling(base) {
    const [pendingConfirm, setPendingConfirm] = useState(null);
    useEffect(() => {
        let alive = true;
        let failures = 0;
        let timer;
        const poll = async () => {
            try {
                const item = await fetchPendingConfirm(base);
                if (!alive)
                    return;
                failures = 0;
                setPendingConfirm(item);
            }
            catch {
                failures++;
                if (alive)
                    setPendingConfirm(null);
            }
            finally {
                if (!alive)
                    return;
                const nextDelay = failures >= 3 ? 15_000 : 1_000;
                timer = setTimeout(poll, nextDelay);
            }
        };
        poll();
        return () => {
            alive = false;
            if (timer !== undefined)
                clearTimeout(timer);
        };
    }, [base]);
    const resolveConfirm = async (id, decision) => {
        const ok = await submitConfirmDecision(base, id, decision);
        if (ok) {
            setPendingConfirm(null);
        }
    };
    return { pendingConfirm, resolveConfirm };
}
//# sourceMappingURL=useConfirmPolling.js.map