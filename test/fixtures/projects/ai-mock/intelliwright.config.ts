import { defineConfig } from "intelliwright";
import { createMockEvaluator } from "intelliwright/testing";
import { judge } from "./judge";

const provider = process.env.FAKE_JEV_URL
  ? { baseURL: process.env.FAKE_JEV_URL, apiKey: "test-key", name: "Fake Jev" }
  : process.env.NO_PROVIDER
    ? undefined
    : createMockEvaluator(judge);

export default defineConfig({
  testDir: "e2e",
  baseURL: "http://app.test",
  workers: 2,
  expect: { timeout: 3_000 },
  reporters: ["json"],
  ai: {
    provider,
    minProbability: 0.7,
    redact: [/\b\d{4}-\d{4}-\d{4}-\d{4}\b/, "[data-private]"],
  },
});
