import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "es2022",
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: false,
  outDir: "lib",
});
