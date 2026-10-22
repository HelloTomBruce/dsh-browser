import type { PendingConfirm } from "../types.js";
export declare function useConfirmPolling(base: string): {
    pendingConfirm: PendingConfirm | null;
    resolveConfirm: (id: string, decision: "allowed" | "denied") => Promise<void>;
};
//# sourceMappingURL=useConfirmPolling.d.ts.map