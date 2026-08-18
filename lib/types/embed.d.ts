import type { ReefContext, WebRoute } from "./lib/types.js";
export declare function applyEmbed(ctx: ReefContext, webServer: {
    register(route: WebRoute): () => void;
    tapIndex(transform: (html: string) => string): () => void;
    port?: number;
}, base: string): () => void;
//# sourceMappingURL=embed.d.ts.map