import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.mjs",
  workers: 1,
});
