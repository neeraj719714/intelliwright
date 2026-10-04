import { defineConfig } from "intelliwright";
import { createMockEvaluator } from "intelliwright/testing";
import { agent } from "./agent";

const port = process.env.FIXTURE_PORT ?? "4175";

export default defineConfig({
  testDir: "e2e",
  baseURL: `http://127.0.0.1:${port}`,
  webServer: {
    command: `node ../../sites/serve.mjs ../../sites/static ${port}`,
    url: `http://127.0.0.1:${port}`,
  },
  workers: 2,
  timeout: 60_000,
  reporters: ["terminal", "json"],
  ai: { provider: process.env.LIVE ? "typesafe" : createMockEvaluator(agent), cache: false },
});
