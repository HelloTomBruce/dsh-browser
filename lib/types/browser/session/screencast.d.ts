import type { Page } from "playwright-core";
export interface ScreencastFrame {
    /** 原始 JPEG 图像 Buffer */
    buffer: Buffer;
    /** Base64 编码字符串 */
    base64: string;
    /** CDP 帧元数据 (如 deviceWidth, deviceHeight, pageScaleFactor 等) */
    metadata: Record<string, any>;
    timestamp: number;
}
export type FrameListener = (frame: ScreencastFrame) => void;
declare class ScreencastManager {
    private cdp;
    private currentPage;
    private listeners;
    private isStarting;
    private lastFrame;
    /**
     * 注册帧监听器。返回注销函数。
     * 当第一个监听器加入时自动激活 CDP Screencast；
     * 当所有监听器离开时自动注销并停止 CDP，实现零空载开销。
     */
    subscribe(listener: FrameListener): () => void;
    get subscriberCount(): number;
    getLastFrame(): ScreencastFrame | null;
    /**
     * 启动 CDP Screencast
     */
    start(targetPage?: Page | null): Promise<boolean>;
    /**
     * 停止 CDP Screencast，静默释放资源
     */
    stop(): Promise<void>;
}
export declare const screencastManager: ScreencastManager;
export {};
//# sourceMappingURL=screencast.d.ts.map