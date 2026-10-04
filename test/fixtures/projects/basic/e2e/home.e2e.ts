import { expect, test } from "intelliwright";
import { logWorker } from "./support";

test.beforeEach(({}, testInfo) => logWorker(testInfo));

test.describe("home page", () => {
  test("shows the welcome heading", async ({ page }) => {
    await page.goto("/");
    expect(await page.title()).toBe("Fixture Home");
    expect(await page.getByRole("heading", { level: 1 }).textContent()).toBe("Welcome to the fixture site");
  });

  test("links to the about page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "About" }).click();
    await page.waitForURL("**/about.html");
    expect(await page.title()).toBe("About");
  });
});
