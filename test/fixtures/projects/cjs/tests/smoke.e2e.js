const { expect, test } = require("intelliwright");

test("runs in a CommonJS project", async ({ page }) => {
  await page.setContent("<h1>CommonJS works</h1>");
  expect(await page.locator("h1").textContent()).toBe("CommonJS works");
});
