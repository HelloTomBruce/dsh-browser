/** 录制存储目录($DSH_HOME/.dsh-browser/recordings)。 */
export declare function recordingsDir(): string;
/** 名字安全化:只保留字母数字 . _ -,连续点压成下划线防路径穿越。 */
export declare function safeName(name: string): string;
/** 加载目录下所有 .json 录制进内存表;返回加载数量。坏文件静默跳过。 */
export declare function loadRecordings(): number;
/** 写一个录制到磁盘(原子替换);返回文件路径。 */
export declare function saveRecordingFile(name: string, steps: {
    tool: string;
    args: any;
}[]): string;
/** 删除磁盘上的录制文件;返回是否存在并删除。 */
export declare function deleteRecordingFile(name: string): boolean;
/** 录制列表(面板 / browser_record list 共用)。 */
export declare function listRecordings(): Array<{
    name: string;
    steps: number;
    savedAt: number;
    preview: string;
}>;
/** 录制详情(面板展开查看步骤)。 */
export declare function recordingDetail(name: string): {
    name: string;
    steps: {
        tool: string;
        args: any;
    }[];
} | undefined;
/** 删除录制(内存 + 磁盘同步);返回是否存在并删除。 */
export declare function deleteRecording(name: string): boolean;
//# sourceMappingURL=recordings.d.ts.map