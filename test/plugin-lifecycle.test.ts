import { describe, expect, it, vi } from "vitest";
import { apply } from "../src/index.js";
import type { ReefContext, WebRoute } from "../src/lib/types.js";

describe("Plugin Lifecycle & Injection", () => {
  it("reactively registers webServer routes via ctx.inject", () => {
    const registeredRoutes: WebRoute[] = [];
    const webServerMock = {
      port: 8080,
      register: vi.fn((route: WebRoute) => {
        registeredRoutes.push(route);
        return () => {};
      }),
    };

    const injectCallbacks = new Map<string, (ctx: ReefContext) => void>();

    const mockCtx: ReefContext = {
      get: vi.fn(((name: string) => {
        if (name === "webServer") return undefined; // webServer not ready initially
        return undefined;
      }) as any),
      effect: vi.fn(),
      inject: vi.fn((names: string[], callback: (ctx: ReefContext) => void) => {
        for (const name of names) {
          injectCallbacks.set(name, callback);
        }
      }),
    };

    apply(mockCtx, { basePath: "/browser" });

    // Ensure ctx.inject was requested for webServer, tools, systemPrompt
    expect(mockCtx.inject).toHaveBeenCalledWith(["webServer"], expect.any(Function));
    expect(mockCtx.inject).toHaveBeenCalledWith(["tools"], expect.any(Function));
    expect(mockCtx.inject).toHaveBeenCalledWith(["systemPrompt"], expect.any(Function));

    // Initially no routes registered because webServer hasn't triggered
    expect(registeredRoutes.length).toBe(0);

    // Simulate webServer becoming ready later
    const webCtx: ReefContext = {
      get: vi.fn(((name: string) => (name === "webServer" ? webServerMock : undefined)) as any),
      effect: vi.fn(),
    };
    injectCallbacks.get("webServer")!(webCtx);

    // Now routes must be registered!
    expect(webServerMock.register).toHaveBeenCalledTimes(2);
    expect(registeredRoutes.some((r) => r.path === "/browser")).toBe(true);
    expect(registeredRoutes.some((r) => r.path === "/__dsh-browser-view__/config")).toBe(true);
  });

  it("falls back gracefully when ctx.inject is not provided", () => {
    const registeredRoutes: WebRoute[] = [];
    const webServerMock = {
      port: 8080,
      register: vi.fn((route: WebRoute) => {
        registeredRoutes.push(route);
        return () => {};
      }),
    };

    const mockCtx: ReefContext = {
      get: vi.fn(((name: string) => (name === "webServer" ? webServerMock : undefined)) as any),
      effect: vi.fn(),
    };

    apply(mockCtx, { basePath: "/browser" });

    expect(registeredRoutes.some((r) => r.path === "/browser")).toBe(true);
    expect(registeredRoutes.some((r) => r.path === "/__dsh-browser-view__/config")).toBe(true);
  });
});
