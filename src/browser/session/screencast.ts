// dsh-browser · 会话实时画面流式推流 (CDP Screencast Manager)
import type { CDPSession, Page } from "playwright-core";
import { activePage } from "../session.js";

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

class ScreencastManager {
  private cdp: CDPSession | null = null;
  private currentPage: Page | null = null;
  private listeners = new Set<FrameListener>();
  private isStarting = false;
  private lastFrame: ScreencastFrame | null = null;

  /**
   * 注册帧监听器。返回注销函数。
   * 当第一个监听器加入时自动激活 CDP Screencast；
   * 当所有监听器离开时自动注销并停止 CDP，实现零空载开销。
   */
  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    if (this.lastFrame) {
      try {
        listener(this.lastFrame);
      } catch {
        /* ignore */
      }
    }
    if (this.listeners.size === 1) {
      void this.start();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        void this.stop();
      }
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  getLastFrame(): ScreencastFrame | null {
    return this.lastFrame;
  }

  /**
   * 启动 CDP Screencast
   */
  async start(targetPage?: Page | null): Promise<boolean> {
    if (this.cdp !== null || this.isStarting) return true;
    const page = targetPage ?? activePage();
    if (!page || page.isClosed()) return false;

    this.isStarting = true;
    try {
      this.currentPage = page;
      // 监听页面关闭事件，自动重置
      page.once("close", () => {
        if (this.currentPage === page) {
          void this.stop();
        }
      });

      const context = page.context();
      if (typeof context.newCDPSession !== "function") {
        // 非 Chromium 或模拟环境，降级退出
        this.isStarting = false;
        return false;
      }

      const cdp = await context.newCDPSession(page);
      this.cdp = cdp;

      cdp.on("Page.screencastFrame", async (payload: { data: string; sessionId: number; metadata: any }) => {
        try {
          const buffer = Buffer.from(payload.data, "base64");
          const frame: ScreencastFrame = {
            buffer,
            base64: payload.data,
            metadata: payload.metadata || {},
            timestamp: Date.now(),
          };
          this.lastFrame = frame;

          // 广播至所有订阅客户端
          for (const listener of this.listeners) {
            try {
              listener(frame);
            } catch {
              /* ignore subscriber error */
            }
          }

          // 向 CDP 确认帧已处理
          await cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => {});
        } catch {
          /* ignore frame dispatch errors */
        }
      });

      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 2,
      });

      return true;
    } catch {
      await this.stop();
      return false;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * 停止 CDP Screencast，静默释放资源
   */
  async stop(): Promise<void> {
    const cdp = this.cdp;
    this.cdp = null;
    this.currentPage = null;
    this.isStarting = false;

    if (cdp !== null) {
      try {
        await cdp.send("Page.stopScreencast").catch(() => {});
        await cdp.detach().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }
}

export const screencastManager = new ScreencastManager();
