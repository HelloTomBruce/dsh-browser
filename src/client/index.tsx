/**
 * dsh-browser-view client half:
 * 1. "settings.section" -> A "浏览器" page in official dsh settings dialog
 *    (nav icon patched to a browser glyph by ./navIcon.ts — the shell hardcodes
 *    a gear for unknown section ids).
 * 2. "shell.overlay" -> Universal floating widget (FAB + live screenshot + modal).
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { BrowserFloatingOverlay } from "./components/FloatingOverlay.js";
import { BrowserSettingsSection } from "./components/SettingsSection.js";
import { installSettingsNavIconPatch } from "./navIcon.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; scope: "root" };
  }
}

/** Required services (cordis fiber inject). */
export const inject = ["slots"];

/**
 * Register the browser extension components:
 * 1. settings.section -> "浏览器" page in settings
 * 2. shell.overlay -> Universal floating live screenshot widget (Desktop & Web)
 */
export function apply(ctx: ClientContext): void {
  // 1. Settings page with browser icon
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "browser",
        order: 40,
        label: "浏览器",
      },
      BrowserSettingsSection,
    ),
  );

  // 1b. 设置外壳对未知分区 id 一律画齿轮图标,且无自定义图标的 slot API——
  // 运行时补丁藏齿轮、换自绘浏览器图标(失败静默回退,见 navIcon.ts 头注释)。
  installSettingsNavIconPatch(ctx);

  // 2. Universal floating widget (Desktop & Web)
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-browser-overlay",
        order: 100,
      },
      BrowserFloatingOverlay,
    ),
  );
}
