// dsh-browser shared HTTP helpers for webServer route handlers.
// webServer handlers receive plain node:http IncomingMessage/ServerResponse.
/** Parse the request URL pathname (query strings are ignored). */
export function urlPath(req) {
    try {
        return new URL(req.url ?? "/", "http://x").pathname;
    }
    catch {
        return "/";
    }
}
/** Read the request body as a UTF-8 string (bounded). */
export function readRawBody(req, limitBytes = 1_000_000) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error("request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}
/** Read and parse a JSON request body; `undefined` when the body is empty. */
export async function readJsonBody(req, limitBytes) {
    const raw = await readRawBody(req, limitBytes);
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Send a JSON response. */
export function sendJson(res, status, value, extraHeaders = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        ...extraHeaders,
    });
    res.end(body);
}
/** Send a plain text response. */
export function sendText(res, status, text, headers = {}) {
    res.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "content-length": Buffer.byteLength(text),
        ...headers,
    });
    res.end(text);
}
//# sourceMappingURL=http.js.map