import { expect, test } from "intelliwright";
import { logWorker } from "./support";

test.beforeEach(({}, testInfo) => logWorker(testInfo));

test("passes on the second attempt", async ({ page }, testInfo) => {
  await page.goto("/");
  expect(testInfo.retry).toBe(1);
});
