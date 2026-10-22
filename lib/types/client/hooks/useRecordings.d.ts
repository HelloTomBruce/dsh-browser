import type { RecordingDetail, RecordingRow } from "../types.js";
export declare function useRecordings(base: string): {
    list: RecordingRow[] | null;
    error: string;
    expanded: Record<string, "failed" | RecordingDetail | "loading" | undefined>;
    toggleDetail: (name: string) => void;
    remove: (name: string) => Promise<void>;
};
//# sourceMappingURL=useRecordings.d.ts.map