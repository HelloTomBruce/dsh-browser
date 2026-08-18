/**
 * dsh-browser browser half: a "浏览器" page in the official dsh settings
 * dialog (settings.section seat) that manages saved browser recordings —
 * list, expand steps, delete. Data flows to the node half through the
 * plugin's own same-origin HTTP endpoints (base path discovered from
 * /__dsh-browser__/config).
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Register the "浏览器" settings page: nav entry + recordings management.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map