/** 记录最近一次截图目录(截图工具调用时写入)。 */
export declare function noteScreenshotDir(dir: string): void;
/** 定时清扫入口:若已知截图目录则按当前配置清理。 */
export declare function sweepScreenshotDir(opts: {
    maxAgeDays?: number;
    maxCount?: number;
}): number;
/**
 * 清理截图目录里的 .png 文件:按修改时间保留最新的 maxCount 个,
 * 并删除超过 maxAgeDays 天的旧文件。只处理目录直属文件,不递归;
 * 单个文件删除失败(被占用等)静默跳过。返回删除数量。
 */
export declare function cleanupScreenshots(dir: string, opts: {
    maxAgeDays?: number;
    maxCount?: number;
}): number;
//# sourceMappingURL=screenshot.d.ts.map