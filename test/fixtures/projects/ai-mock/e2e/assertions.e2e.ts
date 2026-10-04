import { expect, test } from "intelliwright";

const app = test.extend<{ serve: (html: string) => Promise<void> }>({
  serve: async ({ page }, provide) => {
    await provide(async (html) => {
      await page.route("http://app.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Fixture App</title><body>${html}</body>` }),
      );
      await page.goto("/");
    });
  },
});

app("a claim at the threshold passes", async ({ page, serve }) => {
  await serve("<h1>Hello</h1>");
  await expect(page).toSatisfy("[p=0.70] the page greets the visitor");
});

app("a claim just below the threshold fails", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<h1>Hello</h1>");
  await expect(page).toSatisfy("[p=0.69] the page greets the visitor", { timeout: 500 });
});

app("minProbability can be raised for one check", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<h1>Hello</h1>");
  await expect(page).toSatisfy("[p=0.80] the page greets the visitor", { minProbability: 0.9, timeout: 500 });
});

app(".not passes at 1 - minProbability or below", async ({ page, serve }) => {
  await serve("<h1>Hello</h1>");
  await expect(page).not.toSatisfy("[p=0.30] the page shows an error");
});

app(".not fails when Jev is unsure", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<h1>Hello</h1>");
  await expect(page).not.toSatisfy("[p=0.31] the page shows an error", { timeout: 500 });
});

app("waits while the page is loading and asks again when it changes", async ({ page, serve }) => {
  await serve(
    `<p id="progress">Loading…</p><script>setTimeout(() => { document.getElementById("progress").outerHTML = "<h1>Ready</h1>" }, 700)</script>`,
  );
  await expect(page).toSatisfy('the heading says "Ready"');
});

app("doesn't ask again while the page stays the same", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<p>Loading…</p>");
  await expect(page).toSatisfy('the heading says "Ready"', { timeout: 1_000 });
});

app("fails early once the page has settled", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<h1>Welcome</h1>");
  await expect(page).toSatisfy('the heading says "Ready"', { timeout: 10_000 });
});

app("toSatisfyAll checks several claims in one request", async ({ page, serve }) => {
  await serve("<h1>Shop</h1><p>Cart: 3 items</p><button>Checkout</button>");
  await expect(page).toSatisfyAll(['the heading says "Shop"', 'the page says "Cart: 3 items"', 'there is a "Checkout" button']);
});

app("toSatisfyAll lists every claim when one fails", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve("<h1>Shop</h1>");
  await expect(page).toSatisfyAll(['the heading says "Shop"', 'the page says "Cart: 3 items"'], { timeout: 500 });
});

app("toScore rates the page", async ({ page, serve }) => {
  await serve('<p role="alert">A clear message about what went wrong</p>');
  await expect(page).toScore("How clear is the error message?", ["Unclear", "Vague", "Clear", "Very clear"], { atLeast: 2 });
});

app("a locator scopes the claim to one element", async ({ page, serve }) => {
  await serve("<header><h1>Header title</h1></header><main><p>Main text</p></main>");
  await expect(page.getByRole("main")).toSatisfy('the element says "Main text"');
  await expect(page.getByRole("main")).not.toSatisfy('the element says "Header title"');
});

app("ai.evaluate answers typed questions and never sees secrets", async ({ page, serve, ai }) => {
  await serve('<label>Password <input type="password" id="pw"></label><p>Card 4242-4242-4242-4242</p><p data-private>private note</p>');
  await page.fill("#pw", "s3cret-pass");
  const { leaked, redacted, plan } = await ai.evaluate({
    leaked: { type: "boolean", instructions: "[leak]" },
    redacted: { type: "boolean", instructions: "[redacted-present]" },
    plan: { type: "choice", instructions: "Which plan?", criteria: { free: null, pro: null } },
  });
  expect(leaked.probability).toBe(0);
  expect(redacted.probability).toBe(1);
  expect(plan.choice).toBe("free");
});
