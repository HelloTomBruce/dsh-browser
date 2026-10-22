import { type MouseEvent } from "react";
import type { NavHistoryItem, Palette, BrowserStatus } from "../types.js";
interface InspectionModalProps {
    status: BrowserStatus | null;
    history: NavHistoryItem[];
    shotSrc: string;
    dark: boolean;
    palette: Palette;
    onClose: () => void;
}
export declare function InspectionModal({ status, history, shotSrc, dark, palette: p, onClose, }: InspectionModalProps): import("react").DetailedReactHTMLElement<{
    onClick: (e: MouseEvent) => void;
    style: {
        position: "fixed";
        inset: number;
        zIndex: number;
        display: "flex";
        alignItems: "center";
        justifyContent: "center";
        padding: string;
        background: string;
        pointerEvents: "auto";
    };
}, HTMLElement>;
interface ReportModalProps {
    base: string;
    dark: boolean;
    palette: Palette;
    onClose: () => void;
}
export declare function ReportModal({ base, dark, palette: p, onClose }: ReportModalProps): import("react").DetailedReactHTMLElement<{
    onClick: (e: MouseEvent) => void;
    style: {
        position: "fixed";
        inset: number;
        zIndex: number;
        display: "flex";
        alignItems: "center";
        justifyContent: "center";
        padding: string;
        background: string;
        pointerEvents: "auto";
    };
}, HTMLElement>;
export {};
//# sourceMappingURL=InspectionModal.d.ts.map