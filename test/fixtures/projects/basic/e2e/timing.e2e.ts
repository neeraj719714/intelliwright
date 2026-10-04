import { test } from "intelliwright";
import { logWorker } from "./support";

test.beforeEach(({}, testInfo) => logWorker(testInfo));

test("runs out of time", async ({ page }) => {
  test.setTimeout(1_000);
  await page.goto("/");
  await new Promise((resolve) => setTimeout(resolve, 5_000));
});
