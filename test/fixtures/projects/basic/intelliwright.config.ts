import { defineConfig } from "intelliwright";

const port = process.env.FIXTURE_PORT ?? "4173";

export default defineConfig({
  testDir: "./e2e",
  baseURL: `http://127.0.0.1:${port}`,
  webServer: {
    command: `node ../../sites/serve.mjs ../../sites/static ${port}`,
    url: `http://127.0.0.1:${port}`,
  },
  workers: 2,
  retries: 1,
  timeout: 10_000,
});
