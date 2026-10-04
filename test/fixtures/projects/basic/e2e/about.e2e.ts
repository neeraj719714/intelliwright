import { expect, test } from "intelliwright";
import { logWorker } from "./support";

test.beforeEach(({}, testInfo) => logWorker(testInfo));

test("shows the about heading", async ({ page }) => {
  await page.goto("/about.html");
  expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("About us");
});

test("has the wrong title on purpose", async ({ page }) => {
  await page.goto("/about.html");
  expect(await page.title()).toBe("Not the about page");
});
