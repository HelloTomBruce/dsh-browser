import type { PendingConfirm } from "../types.js";
interface ConfirmCardProps {
    confirm: PendingConfirm;
    dark: boolean;
    onDecision: (decision: "allowed" | "denied") => void;
}
export declare function ConfirmCard({ confirm, dark, onDecision }: ConfirmCardProps): import("react").DetailedReactHTMLElement<{
    style: {
        padding: string;
        borderRadius: string;
        border: string;
        background: string;
        color: "#fca5a5" | "#b91c1c";
        fontSize: string;
        lineHeight: string;
    };
    title: string;
}, HTMLElement>;
export {};
//# sourceMappingURL=ConfirmCard.d.ts.map