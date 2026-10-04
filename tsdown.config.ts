import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig[] = defineConfig([
  {
    entry: {
      index: "src/index.ts",
      testing: "src/testing/index.ts",
      "ai-sdk": "src/ai-sdk/index.ts",
      cli: "src/cli/index.ts",
    },
    format: "esm",
    platform: "node",
    target: "node22",
    fixedExtension: false,
    dts: true,
    exports: { exclude: ["cli", "report-app"], bin: true },
    publint: true,
    attw: { profile: "esm-only", level: "error" },
  },
  {
    // The HTML report's Preact app, inlined into each report by the html reporter.
    entry: { "report-app": "src/reporters/html/app/main.tsx" },
    format: "iife",
    platform: "browser",
    target: "es2022",
    dts: false,
    minify: true,
    clean: false,
  },
]);

export default config;
