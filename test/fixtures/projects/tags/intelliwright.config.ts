import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "e2e",
  workers: 2,
  suites: { smoke: "@smoke", nightly: "@smoke or @regression", fast: "not @slow" },
});
