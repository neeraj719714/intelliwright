import { test } from "intelliwright";

test.describe("auth", { tag: "@auth" }, () => {
  test("signs in", { tag: "@smoke" }, async () => {});

  test("rejects a bad password", { tag: ["@regression", "@slow"] }, async () => {});
});

test("signs out @smoke", async () => {});
