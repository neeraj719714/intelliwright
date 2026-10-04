import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  reporters: ["terminal", "json"],
  ai: { provider: "typesafe" },
});
