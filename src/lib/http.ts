// dsh-browser shared HTTP helpers for webServer route handlers.
// webServer handlers receive plain node:http IncomingMessage/ServerResponse.

import type { IncomingMessage, ServerResponse } from "node:http";

/** Parse the request URL pathname (query strings are ignored). */
export function urlPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://x").pathname;
  } catch {
    return "/";
  }
}

/** Send a JSON response. */
export function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** Send a plain text response. */
export function sendText(
  res: ServerResponse,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}
