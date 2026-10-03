import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
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
  exports: { exclude: ["cli"], bin: true },
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});

export default config;
