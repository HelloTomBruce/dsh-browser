/**
 * dsh-browser-view client half:
 * 1. "settings.section" -> A "🌐 浏览器" page in official dsh settings dialog.
 * 2. "shell.overlay" -> Universal floating widget (FAB + live screenshot + modal).
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-slots";
import { BrowserFloatingOverlay } from "./components/FloatingOverlay.js";
import { BrowserSettingsSection } from "./components/SettingsSection.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; scope: "root" };
  }
}

/** Required services (cordis fiber inject). */
export const inject = ["slots"];

/**
 * Register the browser extension components:
 * 1. settings.section -> "🌐 浏览器" page in settings
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
        label: "🌐 浏览器",
      },
      BrowserSettingsSection,
    ),
  );

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
