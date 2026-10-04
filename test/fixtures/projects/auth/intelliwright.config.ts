import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "e2e",
  use: { auth: "member" },
  workers: 2,
  reporters: ["json", "terminal"],
});
