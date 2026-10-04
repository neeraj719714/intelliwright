---
title: Signing in
description: Sign in once per run with test.auth() in a setup file, and start tests already signed in as a role.
---

Signing in through the UI in every test is slow, and it makes every test depend on the sign-in page. Instead, sign in once per run for each role, save the browser's state, and start the tests that need it already signed in. This works like Playwright's setup projects with `storageState`.

## Write a sign-in

Sign-ins live in setup files: files in `testDir` whose names end in `.setup.ts` (or `.setup.js` and the like), such as `e2e/auth.setup.ts`. Each `test.auth(role, body)` signs in as one role:

```ts title="e2e/auth.setup.ts"
import { expect, test } from "./fixtures";

test.auth("member", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.E2E_MEMBER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MEMBER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});
```

- The body gets the same fixtures as a test, so it can use page objects from `./fixtures`.
- End every sign-in with an assertion that proves it worked. The state is saved only when the body passes, so the assertion makes sure the session cookies are there first.
- Read credentials from environment variables, such as ones in `.env.local`, and use dedicated test accounts. Never write a password in a test file.
- If the app has a sign-in API, `page.request` shares cookies with the page, so `await page.request.post("/api/sign-in", { data })` is faster than filling in the form.

Role names use letters, numbers, `-` and `_`, such as `member` or `admin-2`.

## Use a role in tests

Pick a role for every test in the config:

```ts title="intelliwright.config.ts"
export default defineConfig({
  use: { auth: "member" },
});
```

Or for one file or `describe`:

```ts title="e2e/account.e2e.ts"
import { expect, test } from "./fixtures";

test.use({ auth: "member" });

test("shows the account's email", async ({ accountPage }) => {
  await accountPage.goto();
  await expect(accountPage.email).toHaveText(process.env.E2E_MEMBER_EMAIL!);
});
```

`test.use({ auth: null })` starts the tests in its scope signed out, even when the config picks a role. A `test.use()` inside a `describe` applies to that group only.

## What happens during a run

1. Intelliwright works out which roles the selected tests need. Roles that no selected test needs don't sign in.
2. Each needed role signs in once, before any test runs, in a fresh signed-out browser context.
3. When a sign-in passes, its cookies, local storage and IndexedDB are saved to `.intelliwright/auth/<role>.json`.
4. Each test with a role starts in a new browser context loaded with that state.

`npx intelliwright test --list` shows which roles a run would sign in as:

```text
Listing tests:
  e2e/account.e2e.ts:5 › shows the account's email
Total: 1 test in 1 file
Signs in first as: member
```

## When a sign-in fails

The tests that need that role are skipped with the reason `Signing in as "member" failed.`, and the run fails. Tests that don't need it still run. `--last-failed` reruns the tests that were skipped this way, together with the sign-in.

Other mistakes are reported before anything runs:

- A test uses a role with no `test.auth()`: `No sign-in for "admin".` Its tests are skipped.
- Two `test.auth()` calls sign in as the same role: the error names both places.
- A `test()` in a setup file, or a `test.auth()` outside one, throws when the file loads.

## Keeping secrets safe

- The saved state holds session cookies. `intelliwright init` adds `.intelliwright/auth/` to `.gitignore`; never commit it.
- Sign-ins aren't traced, so a typed password never ends up in a trace file.
- Password field values are always masked before a page is sent to Jev.
