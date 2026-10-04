import { expect, test } from "intelliwright";

test("members start signed in, with their local storage", async ({ page }) => {
  await page.goto("/auth/account.html");
  await expect(page.getByRole("heading")).toHaveText("Signed in as Jane");
  await expect(page.getByText("Theme: dark")).toBeVisible();
});

test.describe("as an admin", () => {
  test.use({ auth: "admin" });

  test("admins start signed in as themselves", async ({ page }) => {
    await page.goto("/auth/account.html");
    await expect(page.getByRole("heading")).toHaveText("Signed in as Ada");
  });
});

test.describe("guests", { tag: "@guest" }, () => {
  test.use({ auth: null });

  test("guests start signed out", async ({ page }) => {
    await page.goto("/auth/account.html");
    await expect(page.getByRole("heading")).toHaveText("Signed out");
    await expect(page.getByText("Theme: light")).toBeVisible();
  });
});
