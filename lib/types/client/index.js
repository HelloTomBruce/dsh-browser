import { BrowserFloatingOverlay } from "./components/FloatingOverlay.js";
import { BrowserSettingsSection } from "./components/SettingsSection.js";
/** Required services (cordis fiber inject). */
export const inject = ["slots"];
/**
 * Register the browser extension components:
 * 1. settings.section -> "🌐 浏览器" page in settings
 * 2. shell.overlay -> Universal floating live screenshot widget (Desktop & Web)
 */
export function apply(ctx) {
    // 1. Settings page with browser icon
    ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "browser",
        order: 40,
        label: "🌐 浏览器",
    }, BrowserSettingsSection));
    // 2. Universal floating widget (Desktop & Web)
    ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "dsh-browser-overlay",
        order: 100,
    }, BrowserFloatingOverlay));
}
//# sourceMappingURL=index.js.map