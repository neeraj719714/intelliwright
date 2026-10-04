import { expect, test } from "intelliwright";

const PAGE = `
  <header><nav><a href="#">Home</a> <a href="#">Pricing</a></nav></header>
  <main>
    <h1>Welcome to Acme Notes</h1>
    <p>Write notes, share them with your team, and find them again in seconds.</p>
    <button>Start free trial</button>
  </main>`;

test("a true claim passes", async ({ page }) => {
  await page.setContent(PAGE);
  await expect(page).toSatisfy("the page welcomes visitors to a note-taking product");
});

test("a false claim fails", { tag: "@expected-failure" }, async ({ page }) => {
  await page.setContent(PAGE);
  await expect(page).toSatisfy("the page shows a shopping cart with three items", { timeout: 2_000 });
});
