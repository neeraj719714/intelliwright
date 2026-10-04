---
title: Fixtures
description: The built-in fixtures, adding your own with test.extend, setup and teardown, and overriding fixtures.
---

A fixture is a value that a test receives by naming it in its first parameter, such as `page` in `async ({ page }) => …`. Intelliwright sets up only the fixtures a test asks for, in the order they depend on each other, and cleans them up in reverse order when the test ends.

## Built-in fixtures

| Fixture | What it is |
| --- | --- |
| `page` | A new Playwright `Page` in the test's context. |
| `context` | A new `BrowserContext` for the test, with the config's `use` options and `baseURL`, and the [saved sign-in](signing-in.md) when the test has one. |
| `browser` | The `Browser` that the tests in a worker share. |
| `browserName` | `chromium`, `firefox` or `webkit`. |
| `baseURL` | The `baseURL` from the config or `--base-url`. |
| `ai` | [Jev-powered actions and questions](../jev/actions.md) on `page`. |

## Adding fixtures

`test.extend()` returns a new `test` function with more fixtures. Export it from `e2e/fixtures.ts`, together with `expect`, and import both from there in every test:

```ts title="e2e/fixtures.ts"
import { test as base } from "intelliwright";
import { NoteListPage } from "./pages/note-list.page";
import { SettingsPage } from "./pages/settings.page";

export const test = base.extend<{ noteListPage: NoteListPage; settingsPage: SettingsPage }>({
  noteListPage: async ({ page, ai }, provide) => {
    await provide(new NoteListPage(page, ai));
  },
  settingsPage: async ({ page, ai }, provide) => {
    await provide(new SettingsPage(page, ai));
  },
});

export { expect } from "intelliwright";
```

```ts title="e2e/settings.e2e.ts"
import { expect, test } from "./fixtures";

test("changes the display name", async ({ settingsPage }) => {
  // ...
});
```

A fixture function receives the fixtures it depends on (destructured, like a test), a `provide` callback, and the test's [test info](basics.md#test-info-and-attachments). It sets up the value, hands it over with `await provide(value)`, and when the test is done, `provide` resolves and the rest of the function runs as teardown.

The callback is called `provide` rather than Playwright's `use`, because React's hooks lint rule treats any call to `use(…)` as a hook and fails linting in React projects. Any name works, since it's a positional parameter, but `provide` keeps the linter quiet.

## Setup and teardown

Code after `provide` runs after the test and its `afterEach` hooks, even when the test failed:

```ts
export const test = base.extend<{ note: { id: string; title: string } }>({
  note: async ({ page }, provide) => {
    const response = await page.request.post("/api/notes", { data: { title: `Note ${Date.now()}` } });
    const note = await response.json();
    await provide(note);
    await page.request.delete(`/api/notes/${note.id}`);
  },
});
```

Teardown has 30 seconds. An error in teardown fails the test.

## Depending on other fixtures

A fixture can depend on built-in fixtures and on other fixtures from the same or an earlier `extend`:

```ts
export const test = base.extend<{ signedInEmail: string; accountPage: AccountPage }>({
  signedInEmail: process.env.E2E_MEMBER_EMAIL ?? "",
  accountPage: async ({ page, ai, signedInEmail }, provide) => {
    await provide(new AccountPage(page, ai, signedInEmail));
  },
});
```

A value that isn't a function, like `signedInEmail` here, is a fixture with that fixed value. Each fixture is set up at most once per test, however many fixtures and hooks ask for it.

## Overriding a fixture

Define a fixture with the name of an existing one to replace it. When it destructures its own name, it receives the original:

```ts
import { test as base, type Page } from "intelliwright";

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, provide) => {
    await page.route("**/analytics/**", (route) => route.abort());
    await provide(page);
  },
});
```

Every test that uses this `test` now gets a page that never loads analytics.

## Extending again

`extend` can be called on an extended `test`. Each call adds a layer, and later layers can use and override fixtures from earlier ones:

```ts
export const adminTest = test.extend<{ adminPage: AdminPage }>({
  adminPage: async ({ page, ai }, provide) => {
    await provide(new AdminPage(page, ai));
  },
});
```

## Rules

- Fixture functions and tests must destructure the fixtures they use, as in `async ({ page }, provide) => …`. A rest element such as `{ page, ...rest }` isn't allowed.
- A fixture must call `provide` exactly once.
- Fixtures that depend on each other in a loop are an error that names the loop.
- Asking for a fixture that doesn't exist fails the test with `Unknown fixture "name"`.
- Custom fixtures are set up for each test. Hooks that run once per file, `beforeAll` and `afterAll`, can use only `browser` and `browserName`.
