import { expect, test } from "intelliwright";

const app = test.extend<{ serve: (html: string, path?: string) => Promise<void> }>({
  serve: async ({ page }, provide) => {
    await provide(async (html, path = "/") => {
      await page.route("http://app.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><title>Fixture App</title></head><body>${html}</body></html>` }),
      );
      await page.goto(path);
    });
  },
});

app("toBeVisible waits for an element to appear", async ({ page, serve }) => {
  await serve(`<div id="slot"></div><script>setTimeout(() => { slot.innerHTML = "<button>Ready</button>" }, 400)</script>`);
  await expect(page.getByRole("button", { name: "Ready" })).toBeVisible();
});

app("not.toBeVisible waits for an element to go away", async ({ page, serve }) => {
  await serve(`<p id="toast">Saved</p><script>setTimeout(() => toast.remove(), 400)</script>`);
  await expect(page.getByText("Saved")).not.toBeVisible();
});

app("toHaveText normalizes whitespace and retries", async ({ page, serve }) => {
  await serve(`<h1 id="title">Loading</h1><script>setTimeout(() => { title.textContent = "  Hello\\n   world " }, 300)</script>`);
  await expect(page.getByRole("heading")).toHaveText("Hello world");
  await expect(page.getByRole("heading")).toHaveText(/hello/i);
});

app("toHaveText checks each element of a list", async ({ page, serve }) => {
  await serve(`<ul><li>One</li><li>Two</li><li>Three</li></ul>`);
  await expect(page.getByRole("listitem")).toHaveText(["One", "Two", /thr/i]);
  await expect(page.getByRole("listitem")).toHaveCount(3);
});

app("toHaveURL and toHaveTitle", async ({ page, serve }) => {
  await serve(`<a href="/next">Next</a>`, "/start");
  await expect(page).toHaveURL("/start");
  await expect(page).toHaveTitle("Fixture App");
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/next$/);
});

app("toBeInViewport follows scrolling", async ({ page, serve }) => {
  await serve(`<div style="height: 3000px">Top</div><button>Bottom</button>`);
  const bottom = page.getByRole("button", { name: "Bottom" });
  await expect(bottom).not.toBeInViewport();
  await bottom.scrollIntoViewIfNeeded();
  await expect(bottom).toBeInViewport({ ratio: 1 });
});

app("fails clearly when an element never appears", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve(`<p>Nothing here</p>`);
  await expect(page.getByRole("button", { name: "Missing" })).toBeVisible({ timeout: 300 });
});

app("fails on a strict mode violation", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve(`<p>A</p><p>B</p>`);
  await expect(page.getByRole("paragraph")).toHaveText("A");
});

app("fails when text never matches", { tag: "@expected-failure" }, async ({ page, serve }) => {
  await serve(`<h1>Welcome</h1>`);
  await expect(page.getByRole("heading")).toHaveText("Goodbye", { timeout: 300 });
});
