import type { IncomingMessage, ServerResponse } from "node:http";
/** Parse the request URL pathname (query strings are ignored). */
export declare function urlPath(req: IncomingMessage): string;
/** Read the request body as a UTF-8 string (bounded). */
export declare function readRawBody(req: IncomingMessage, limitBytes?: number): Promise<string>;
/** Read and parse a JSON request body; `undefined` when the body is empty. */
export declare function readJsonBody(req: IncomingMessage, limitBytes?: number): Promise<unknown>;
/** Send a JSON response. */
export declare function sendJson(res: ServerResponse, status: number, value: unknown, extraHeaders?: Record<string, string>): void;
/** Send a plain text response. */
export declare function sendText(res: ServerResponse, status: number, text: string, headers?: Record<string, string>): void;
//# sourceMappingURL=http.d.ts.map