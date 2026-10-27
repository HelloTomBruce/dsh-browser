/**
 * Three artifacts from one package:
 * - lib/index.js      — the node half (browser tools + live view), ESM.
 * - lib/client.js     — the browser half, a CJS closure-factory bundle shaped
 *                       for the dsh web module loader (banner/footer handoff),
 *                       with every non-platform import inlined (react stays
 *                       external, resolved from the loader module table).
 * - lib/mcp.js        — standalone MCP stdio server (bin dsh-browser-mcp),
 *                       independent of the dsh host; SDK stays external.
 */
import { defineConfig, type UserConfig } from "tsdown";

const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

const node: UserConfig = {
  name: "dsh-browser-view",
  entry: { index: "lib/types/index.js" },
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2024",
  fixedExtension: false,
  dts: false,
  clean: false,
  // dsh host packages are runtime-provided by the loader (linked into the
  // profile by `dsh plugin add`); never bundle them into the node half.
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
};

const client: UserConfig = {
  name: "dsh-browser-view/client",
  entry: { client: "lib/types/client/index.js" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: "dsh-browser-view", factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
};

const mcp: UserConfig = {
  name: "dsh-browser-view/mcp",
  entry: { mcp: "lib/types/mcp.js" },
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "es2024",
  fixedExtension: false,
  dts: false,
  clean: false,
  // bin 入口需要 shebang;MCP SDK 与 dsh host 包一样保持外置,不打进产物。
  outputOptions: {
    entryFileNames: "mcp.js",
    banner: "#!/usr/bin/env node",
  },
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^@modelcontextprotocol\/sdk\//],
  },
};

export default defineConfig([node, client, mcp]);
