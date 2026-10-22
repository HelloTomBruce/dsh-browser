import type { BrowserOp, BrowserStatus, LatestRun } from "../types.js";
export declare function useBrowserStatus(base: string): {
    status: BrowserStatus | null;
    ops: BrowserOp[];
    shotVersion: number;
    lastRun: LatestRun | null;
    agentBusy: boolean;
    rerunMsg: string;
    rerunLast: () => Promise<void>;
};
//# sourceMappingURL=useBrowserStatus.d.ts.map