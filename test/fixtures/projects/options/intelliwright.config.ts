import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./global-setup.ts",
  testIdAttribute: "data-test",
  use: { viewport: { width: 800, height: 600 }, locale: "fr-FR" },
  baseURL: "http://127.0.0.1:9",
  webServer: {
    command: 'node -e "process.exit(3)"',
    url: "http://127.0.0.1:9",
  },
  workers: 1,
});
