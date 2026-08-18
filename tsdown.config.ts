/**
 * Two artifacts from one package:
 * - lib/index.js      — the node half (browser tools + live view), ESM.
 * - lib/client.js     — the browser half, a CJS closure-factory bundle shaped
 *                       for the dsh web module loader (banner/footer handoff),
 *                       with every non-platform import inlined (react stays
 *                       external, resolved from the loader module table).
 */
import { defineConfig, type UserConfig } from "tsdown";

const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
];

const node: UserConfig = {
  name: "dsh-browser",
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
  external: [/^@deepseek-ai\//],
};

const client: UserConfig = {
  name: "dsh-browser/client",
  entry: { client: "lib/types/client/index.js" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: "dsh-browser", factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
};

export default defineConfig([node, client]);
