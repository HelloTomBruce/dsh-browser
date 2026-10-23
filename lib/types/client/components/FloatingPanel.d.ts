import type { BrowserOp, BrowserStatus, LatestRun, Palette, PendingConfirm } from "../types.js";
interface FloatingPanelProps {
    status: BrowserStatus | null;
    ops: BrowserOp[];
    lastRun: LatestRun | null;
    agentBusy: boolean;
    rerunMsg: string;
    pendingConfirm: PendingConfirm | null;
    shotSrc: string;
    streamSrc?: string;
    dark: boolean;
    palette: Palette;
    onOpenModal: () => void;
    onOpenReport: () => void;
    onConfirmDecision: (decision: "allowed" | "denied") => void;
    onRerunLast: () => void;
}
export declare function FloatingPanel({ status, ops, lastRun, agentBusy, rerunMsg, pendingConfirm, shotSrc, streamSrc, dark, palette: p, onOpenModal, onOpenReport, onConfirmDecision, onRerunLast, }: FloatingPanelProps): import("react").DetailedReactHTMLElement<{
    style: {
        position: "fixed";
        right: string;
        bottom: string;
        width: string;
        maxHeight: string;
        overflowY: "auto";
        overflowX: "hidden";
        display: "flex";
        flexDirection: "column";
        gap: string;
        border: string;
        borderRadius: string;
        background: string;
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)";
        padding: string;
        pointerEvents: "auto";
    };
}, HTMLElement>;
export {};
//# sourceMappingURL=FloatingPanel.d.ts.map