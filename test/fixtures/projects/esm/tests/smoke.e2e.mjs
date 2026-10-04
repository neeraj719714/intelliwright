import { expect, test } from "intelliwright";

test("runs in an ESM project", async ({ page }) => {
  await page.setContent("<h1>ESM works</h1>");
  expect(await page.locator("h1").textContent()).toBe("ESM works");
});
