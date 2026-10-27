// dsh-browser · 会话实时画面流式推流 (CDP Screencast Manager)
//
// 纯推模型:目标页一律由外部喂入(session 层在 activeId 变化点调 syncTo,
// /stream 订阅时传入当页),本模块不反查会话层,避免循环依赖。
import type { CDPSession, Page } from "playwright-core";

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

export class ScreencastManager {
  private cdp: CDPSession | null = null;
  private currentPage: Page | null = null;
  private listeners = new Set<FrameListener>();
  private lastFrame: ScreencastFrame | null = null;
  /** 期望绑定的页面(syncTo/subscribe 写入);null 表示停流。 */
  private desiredPage: Page | null = null;
  /** ensure 单飞标记:在途收敛循环会在每个 await 后重读 desiredPage,吞并并发 syncTo。 */
  private switching = false;

  /**
   * 注册帧监听器。返回注销函数。
   * page 为订阅时的初始目标页(由调用方解析)。首个订阅者加入时激活 CDP
   * Screencast;全部离开时注销并停止 CDP,保持零空载开销。
   */
  subscribe(listener: FrameListener, page?: Page | null): () => void {
    this.listeners.add(listener);
    if (page !== undefined) this.desiredPage = page;
    if (this.lastFrame) {
      try {
        listener(this.lastFrame);
      } catch {
        /* ignore */
      }
    }
    if (this.listeners.size === 1) {
      void this.ensure();
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.desiredPage = null;
        void this.ensure();
      }
    };
  }

  /**
   * 通知目标页变化(换页重绑 / 置 null 停流)。无订阅者时仅记录意图,
   * 不建 CDP 会话;快速连续换页由收敛循环合并,最终绑定最后一页。
   */
  async syncTo(page: Page | null): Promise<void> {
    this.desiredPage = page;
    await this.ensure();
  }

  /** 停止推流并释放 CDP(closeBrowser 等收尾路径)。 */
  async stop(): Promise<void> {
    await this.syncTo(null);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  getLastFrame(): ScreencastFrame | null {
    return this.lastFrame;
  }

  /**
   * 收敛循环:让 (cdp, currentPage) 与 (desiredPage, listeners) 达成一致。
   * 每轮重读 desiredPage —— await 期间到来的新 syncTo 在下一轮被吞并,
   * 不会因启动中而丢掉换页请求。
   */
  private async ensure(): Promise<void> {
    if (this.switching) return; // 在途循环负责收敛到最新 desiredPage
    this.switching = true;
    try {
      // 上界防御:每多一轮循环都对应一次新的换页意图,正常远小于该值
      for (let round = 0; round < 16; round++) {
        const want = this.desiredPage;
        const idle = this.listeners.size === 0 || want === null || want.isClosed();
        if (idle) {
          if (this.cdp === null) return;
          await this.teardown();
          if (this.desiredPage === want) return;
          continue;
        }
        if (this.currentPage === want && this.cdp !== null) return;
        await this.teardown();
        if (this.desiredPage !== want) continue;
        const attached = await this.attach(want);
        if (!attached) return; // 非 Chromium 等降级:等下一次 syncTo/subscribe 再试
        if (this.desiredPage !== want) continue; // attach 期间又换页,再来一轮
        return;
      }
    } finally {
      this.switching = false;
    }
  }

  /** 停掉当前 CDP 会话并清空绑定;lastFrame 一并清空,防新订阅者回放到旧页帧。 */
  private async teardown(): Promise<void> {
    const cdp = this.cdp;
    this.cdp = null;
    this.currentPage = null;
    this.lastFrame = null;
    if (cdp !== null) {
      try {
        await cdp.send("Page.stopScreencast").catch(() => {});
        await cdp.detach().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  /** 为页面建立 CDP Screencast 会话;失败(非 Chromium 等)静默降级返回 false。 */
  private async attach(page: Page): Promise<boolean> {
    try {
      const context = page.context();
      if (typeof context.newCDPSession !== "function") {
        return false;
      }
      const cdp = await context.newCDPSession(page);
      this.cdp = cdp;
      this.currentPage = page;

      cdp.on("Page.screencastFrame", async (payload: { data: string; sessionId: number; metadata: any }) => {
        if (this.cdp !== cdp) return; // 重绑竞态中旧会话的迟到帧,丢弃
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

      try {
        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: 60,
          maxWidth: 1280,
          maxHeight: 800,
          everyNthFrame: 1, // n>1 会丢稀疏重绘帧:静态页单次重绘可能整帧被跳过,画面停更
        });
      } catch (err) {
        if (this.cdp === cdp) await this.teardown();
        throw err;
      }

      // 页面关闭自愈:与 session 层钩子构成幂等双保险
      page.once("close", () => {
        if (this.currentPage === page) {
          this.desiredPage = null;
          void this.ensure();
        }
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const screencastManager = new ScreencastManager();
