/**
 * dsh-browser-view client half:
 * 1. "settings.section" -> A "🌐 浏览器" page in official dsh settings dialog.
 * 2. "shell.overlay" -> Universal floating widget (FAB + live screenshot + modal).
 */
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
declare module "@deepseek-ai/dsh-client-ui-slots" {
    interface SlotMap {
        "shell.overlay": {
            kind: "list";
            scope: "root";
        };
    }
}
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Register the browser extension components:
 * 1. settings.section -> "🌐 浏览器" page in settings
 * 2. shell.overlay -> Universal floating live screenshot widget (Desktop & Web)
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map