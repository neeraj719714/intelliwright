import { expect, test } from "intelliwright";

test.use({ auth: process.env.GHOST_ROLE ?? null });

test("a role can be switched off", { tag: "@guest" }, async ({ page }) => {
  await page.goto("/auth/account.html");
  await expect(page.getByRole("heading")).toHaveText("Signed out");
});
