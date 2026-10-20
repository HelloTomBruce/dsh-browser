import type { ReplayStep } from "./types.js";
/** 录制存储目录($DSH_HOME/.dsh-browser/recordings)。 */
export declare function recordingsDir(): string;
/** 名字安全化:只保留字母数字 . _ -,连续点压成下划线防路径穿越。 */
export declare function safeName(name: string): string;
/** 加载目录下所有 .json 录制进内存表;返回加载数量。坏文件静默跳过。 */
export declare function loadRecordings(): number;
/** 写一个录制到磁盘(原子替换);返回文件路径。formatVersion 2 起步骤可带 meta(选择器指纹)与 {{var}} 占位符。 */
export declare function saveRecordingFile(name: string, steps: ReplayStep[]): string;
/** 删除磁盘上的录制文件;返回是否存在并删除。 */
export declare function deleteRecordingFile(name: string): boolean;
/**
 * 磁盘热重载:录制文件被外部编辑(手修 JSON)后,同会话内 browser_replay 仍用内存旧缓存。
 * 比较文件 mtime 与内存 savedAt(留 2s 余量容忍写入延迟),更新过则重新加载进内存表。
 * 返回是否发生了重载;文件不存在或损坏时静默保留内存版。
 */
export declare function reloadRecordingIfChanged(name: string): boolean;
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
    steps: ReplayStep[];
} | undefined;
/** 删除录制(内存 + 磁盘同步);返回是否存在并删除。 */
export declare function deleteRecording(name: string): boolean;
//# sourceMappingURL=recordings.d.ts.map