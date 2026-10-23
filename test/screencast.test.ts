import { describe, expect, it, vi } from "vitest";
import { screencastManager } from "../src/browser/session/screencast.js";

describe("CDP Screencast 推流管理器", () => {
  it("无活动页面时 start 优雅返回 false，不抛异常", async () => {
    const started = await screencastManager.start(null);
    expect(started).toBe(false);
  });

  it("支持订阅并按需激活/释放 CDP 资源", async () => {
    let frameAckSessionId = -1;
    let stopCalled = false;
    let startCalled = false;

    // 构造模拟 CDP 会话
    const mockCdp = {
      handlers: {} as Record<string, (payload: any) => void>,
      on(event: string, handler: (payload: any) => void) {
        this.handlers[event] = handler;
      },
      async send(command: string, params?: any) {
        if (command === "Page.startScreencast") {
          startCalled = true;
          return {};
        }
        if (command === "Page.screencastFrameAck") {
          frameAckSessionId = params?.sessionId;
          return {};
        }
        if (command === "Page.stopScreencast") {
          stopCalled = true;
          return {};
        }
        return {};
      },
      async detach() {
        return {};
      },
    };

    // 构造模拟 Page
    const mockPage = {
      isClosed: () => false,
      once: vi.fn(),
      context: () => ({
        newCDPSession: async () => mockCdp,
      }),
    };

    const receivedFrames: any[] = [];
    // 订阅 1
    const unsub1 = screencastManager.subscribe((frame) => {
      receivedFrames.push(frame);
    });

    // 手动用 mockPage 启动验证
    await screencastManager.start(mockPage as any);
    expect(startCalled).toBe(true);

    // 触发一帧 CDP screencastFrame
    const fakeBase64 = Buffer.from("fake-jpeg-data").toString("base64");
    mockCdp.handlers["Page.screencastFrame"]({
      data: fakeBase64,
      sessionId: 42,
      metadata: { deviceWidth: 1024, deviceHeight: 768 },
    });

    // 验证订阅者收到帧并且回复了 Ack
    expect(receivedFrames.length).toBe(1);
    expect(receivedFrames[0].buffer.toString()).toBe("fake-jpeg-data");
    expect(receivedFrames[0].metadata.deviceWidth).toBe(1024);
    expect(frameAckSessionId).toBe(42);

    // 取消订阅
    unsub1();
    expect(screencastManager.subscriberCount).toBe(0);

    // 验证停止
    await screencastManager.stop();
    expect(stopCalled).toBe(true);
  });
});
