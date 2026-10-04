import { defineConfig } from "intelliwright";
import { createMockEvaluator } from "intelliwright/testing";
import { triageJudge } from "./judge";

const port = process.env.FIXTURE_PORT ?? "4176";
const provider = process.env.LIVE ? "typesafe" : process.env.NO_PROVIDER ? undefined : createMockEvaluator(triageJudge);

export default defineConfig({
  testDir: "e2e",
  baseURL: `http://127.0.0.1:${port}`,
  webServer: {
    command: `node ../../sites/serve.mjs ../../sites/static ${port}`,
    url: `http://127.0.0.1:${port}`,
  },
  workers: 2,
  timeout: 15_000,
  reporters: ["terminal", "json", "junit", "html"],
  ai: { provider },
});
