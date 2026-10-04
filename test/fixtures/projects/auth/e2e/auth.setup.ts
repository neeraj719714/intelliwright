import { expect, test } from "intelliwright";

test.auth("member", async ({ page }) => {
  await page.goto("/auth/sign-in.html");
  await page.getByLabel("Name").fill("Jane");
  await page.getByLabel("Password").fill(process.env.MEMBER_PASSWORD ?? "letmein");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Signed in as Jane" })).toBeVisible({ timeout: 2_000 });
});

test.auth("admin", async ({ page }) => {
  await page.goto("/auth/sign-in.html");
  await page.getByLabel("Name").fill("Ada");
  await page.getByLabel("Password").fill("letmein");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Signed in as Ada" })).toBeVisible({ timeout: 2_000 });
});
