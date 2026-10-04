import { expect, test } from "intelliwright";

test("the cart total adds up every item", async ({ page }) => {
  await page.goto("/shop/cart.html");
  await expect(page.getByTestId("total")).toHaveText("Total: $30", { timeout: 1_000 });
});

test("checkout starts from the cart", async ({ page }) => {
  await page.goto("/shop/cart.html");
  await page.getByRole("button", { name: "Chekout" }).click({ timeout: 1_000 });
});

test("the slow list shows its item", async ({ page }) => {
  await page.goto("/shop/slow.html");
  await expect(page.getByText("Item loaded: Travel mug")).toBeVisible({ timeout: 1_000 });
});

test("the item list loads from the API", async ({ page }) => {
  await page.goto(`/shop/items.html?api=http://127.0.0.1:${process.env.DEAD_PORT ?? "9"}`);
  await expect(page.getByRole("listitem")).toHaveCount(3, { timeout: 1_000 });
});

test("goes to the shop", async ({ page }) => {
  await page.goto("/shop/cart.html");
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
});
