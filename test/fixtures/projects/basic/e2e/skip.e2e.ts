import { test } from "intelliwright";

test.skip("is skipped", async () => {});

test.describe("not ready", () => {
  test.fixme("is marked fixme", async () => {});
});

test("skips itself at runtime", async ({}, testInfo) => {
  testInfo.skip(true, "not today");
});
