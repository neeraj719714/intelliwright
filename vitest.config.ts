import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts", "test/contract/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          // Files share fixture projects and their output folders.
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "live",
          include: ["test/live/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "pack",
          include: ["test/pack/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});

export default config;
