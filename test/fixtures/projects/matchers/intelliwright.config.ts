import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "e2e",
  baseURL: "http://app.test",
  expect: { timeout: 2_000 },
  workers: 2,
  reporters: ["json"],
});
