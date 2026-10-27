// CDP Screencast 管理器状态机测试:订阅激活/释放、syncTo 换页重绑、
// 页面关闭自愈、收敛循环合并并发换页。stub 模式照抄 target-resolver.test.ts。
import { describe, expect, it } from "vitest";
import { ScreencastManager } from "../src/browser/session/screencast.js";
import type { CDPSession, Page } from "playwright-core";

interface CdpStub {
  cdp: CDPSession;
  sent: Array<[string, any?]>;
  detached: boolean;
  emitFrame: (data?: string, sessionId?: number) => Promise<void>;
}

function makeCdpStub(): CdpStub {
  const handlers = new Map<string, ((payload: any) => void)[]>();
  const sent: Array<[string, any?]> = [];
  const stub: CdpStub = {
    cdp: null as unknown as CDPSession,
    sent,
    detached: false,
    async emitFrame(data = Buffer.from("frame").toString("base64"), sessionId = 1) {
      for (const h of handlers.get("Page.screencastFrame") ?? []) {
        await h({ data, sessionId, metadata: { deviceWidth: 1280, deviceHeight: 800 } });
      }
    },
  };
  stub.cdp = {
    on: (event: string, handler: (payload: any) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    send: async (command: string, params?: any) => {
      sent.push([command, params]);
      return {};
    },
    detach: async () => {
      stub.detached = true;
    },
  } as unknown as CDPSession;
  return stub;
}

interface PageStub {
  page: Page;
  cdps: CdpStub[];
  closed: boolean;
  emitClose: () => void;
}

interface PageStubOptions {
  /** 首次 newCDPSession 挂起直到该 promise resolve(测并发换页合并) */
  gate?: Promise<void>;
}

function makePageStub(opts?: PageStubOptions): PageStub {
  const cdps: CdpStub[] = [];
  const closeHandlers: Array<() => void> = [];
  let firstSession = true;
  const stub: PageStub = {
    cdps,
    closed: false,
    emitClose: () => {
      stub.closed = true;
      for (const h of closeHandlers) h();
    },
    page: null as unknown as Page,
  };
  stub.page = {
    isClosed: () => stub.closed,
    once: (event: string, handler: () => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
    context: () => ({
      newCDPSession: async () => {
        const cdpStub = makeCdpStub();
        cdps.push(cdpStub);
        if (opts?.gate && firstSession) {
          firstSession = false;
          await opts.gate;
        }
        return cdpStub.cdp;
      },
    }),
  } as unknown as Page;
  return stub;
}

/** 等待 manager 的异步 ensure() 收敛(微任务若干轮)。 */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("CDP Screencast 管理器状态机", () => {
  it("首个订阅者激活 CDP,帧广播+ack;全部退订停止并释放", async () => {
    const m = new ScreencastManager();
    const p = makePageStub();
    const frames: any[] = [];
    const unsub = m.subscribe((f) => frames.push(f), p.page);
    await settle();

    expect(p.cdps.length).toBe(1);
    const startCall = p.cdps[0].sent.find(([c]) => c === "Page.startScreencast");
    expect(startCall).toBeTruthy();
    // everyNthFrame 必须 1:静态页稀疏重绘会被 n>1 整帧丢弃
    expect(startCall?.[1].everyNthFrame).toBe(1);

    await p.cdps[0].emitFrame(Buffer.from("jpeg-1").toString("base64"), 7);
    expect(frames.length).toBe(1);
    expect(frames[0].buffer.toString()).toBe("jpeg-1");
    expect(p.cdps[0].sent.some(([c, args]) => c === "Page.screencastFrameAck" && args.sessionId === 7)).toBe(true);

    unsub();
    await settle();
    expect(m.subscriberCount).toBe(0);
    expect(p.cdps[0].sent.some(([c]) => c === "Page.stopScreencast")).toBe(true);
    expect(p.cdps[0].detached).toBe(true);
  });

  it("迟到的订阅者回放 lastFrame", async () => {
    const m = new ScreencastManager();
    const p = makePageStub();
    const unsub1 = m.subscribe(() => {}, p.page);
    await settle();
    await p.cdps[0].emitFrame(Buffer.from("f0").toString("base64"));

    const replayed: any[] = [];
    const unsub2 = m.subscribe((f) => replayed.push(f));
    expect(replayed.length).toBe(1);
    expect(replayed[0].base64).toBe(Buffer.from("f0").toString("base64"));

    unsub1();
    unsub2();
    await settle();
  });

  it("syncTo 换页:旧会话 stop+detach,新页重绑,lastFrame 清空", async () => {
    const m = new ScreencastManager();
    const pa = makePageStub();
    const pb = makePageStub();
    const frames: any[] = [];
    const unsub = m.subscribe((f) => frames.push(f), pa.page);
    await settle();
    await pa.cdps[0].emitFrame(Buffer.from("old-tab").toString("base64"));
    expect(m.getLastFrame()).not.toBeNull();

    await m.syncTo(pb.page);
    expect(pa.cdps[0].sent.some(([c]) => c === "Page.stopScreencast")).toBe(true);
    expect(pa.cdps[0].detached).toBe(true);
    // 换绑后 lastFrame 必须清空,防新订阅者回放旧标签帧
    expect(m.getLastFrame()).toBeNull();

    expect(pb.cdps.length).toBe(1);
    await pb.cdps[0].emitFrame(Buffer.from("new-tab").toString("base64"));
    expect(frames.at(-1)?.buffer.toString()).toBe("new-tab");

    unsub();
    await settle();
  });

  it("回归:被绑页面关闭后订阅者仍在,再 syncTo 新页能复活(旧实现永不重启)", async () => {
    const m = new ScreencastManager();
    const pa = makePageStub();
    const pb = makePageStub();
    const frames: any[] = [];
    const unsub = m.subscribe((f) => frames.push(f), pa.page);
    await settle();

    pa.emitClose(); // 页面关闭自愈:manager 内部 close 监听
    await settle();
    expect(pa.cdps[0].sent.some(([c]) => c === "Page.stopScreencast")).toBe(true);

    // 订阅数从未归零(面板 MJPEG 连接不断),syncTo 新页必须能重新拉起
    await m.syncTo(pb.page);
    expect(pb.cdps.length).toBe(1);
    await pb.cdps[0].emitFrame(Buffer.from("revived").toString("base64"));
    expect(frames.at(-1)?.buffer.toString()).toBe("revived");

    unsub();
    await settle();
  });

  it("零空载:无订阅者时 syncTo 不建 CDP 会话,订阅到来按 desiredPage 激活", async () => {
    const m = new ScreencastManager();
    const p = makePageStub();
    await m.syncTo(p.page);
    await settle();
    expect(p.cdps.length).toBe(0);

    const unsub = m.subscribe(() => {});
    await settle();
    expect(p.cdps.length).toBe(1);
    unsub();
    await settle();
  });

  it("收敛循环合并并发换页:attach 挂起期间连发 syncTo(B)、syncTo(C),最终只绑 C", async () => {
    const m = new ScreencastManager();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const pa = makePageStub({ gate: gateA });
    const pb = makePageStub();
    const pc = makePageStub();
    const frames: any[] = [];

    const unsub = m.subscribe((f) => frames.push(f), pa.page);
    await settle(); // A 的 attach 挂起在 gate 上(会话已创建、未完成握手)
    expect(pa.cdps.length).toBe(1);

    await m.syncTo(pb.page); // 在途收敛循环负责吞并
    await m.syncTo(pc.page);

    releaseA();
    await settle();

    // A attach 完成后发现 desired 已是 C:拆 A、绑 C;B 从未建会话
    expect(pa.cdps.length).toBe(1);
    expect(pa.cdps[0].sent.some(([c]) => c === "Page.stopScreencast")).toBe(true);
    expect(pb.cdps.length).toBe(0);
    expect(pc.cdps.length).toBe(1);
    await pc.cdps[0].emitFrame(Buffer.from("final-c").toString("base64"));
    expect(frames.at(-1)?.buffer.toString()).toBe("final-c");

    unsub();
    await settle();
  });

  it("stop() 释放 CDP 会话", async () => {
    const m = new ScreencastManager();
    const p = makePageStub();
    const unsub = m.subscribe(() => {}, p.page);
    await settle();
    await m.stop();
    expect(p.cdps[0].detached).toBe(true);
    unsub();
  });
});
