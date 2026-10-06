---
title: Your first test
description: Walk through the files that intelliwright init creates, add a test with a page object, run it, and read the results.
---

This page walks through the files `intelliwright init` created, adds a test of your own, and runs it. The examples use a notes app; swap in your own pages.

## The config

```ts title="intelliwright.config.ts"
import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "./e2e",
  baseURL: "http://localhost:3000",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  ai: { provider: "typesafe" }, // reads TYPESAFE_API_KEY
  suites: { smoke: "@smoke" },
});
```

- `testDir` is where tests live. Test files end in `.e2e.ts` (or `.e2e.js` and the like), so Jest and Vitest don't pick them up.
- `baseURL` lets tests and page objects use paths, such as `page.goto("/notes")`.
- `webServer` starts the app before the tests and stops it afterwards. With `reuseExistingServer: true`, a dev server that is already running is used instead.
- `ai.provider` says which Jev provider to use. Without it, Intelliwright uses the first provider whose key it finds.
- `suites` names tag expressions, so `npx intelliwright test --suite smoke` runs every test tagged `@smoke`.

Every option is listed in the [configuration reference](../reference/configuration.md).

## A page object

Page objects live in `e2e/pages/`, one class per page or large component:

```ts title="e2e/pages/home.page.ts"
import { BasePage } from "intelliwright";

export class HomePage extends BasePage {
  readonly path = "/";
  readonly heading = this.page.getByRole("heading", { level: 1 });
}
```

`BasePage` gives the class `this.page`, a Playwright `Page`, and `this.ai`, for Jev-powered actions. Its `goto()` opens `path` relative to `baseURL`. See [Page objects](../writing-tests/page-objects.md).

## Fixtures

```ts title="e2e/fixtures.ts"
import { test as base } from "intelliwright";
import { HomePage } from "./pages/home.page";

// Page objects that tests receive by name. The callback is called provide,
// not use, so React's hooks lint rule doesn't mistake it for a hook.
export const test = base.extend<{ homePage: HomePage }>({
  homePage: async ({ page, ai }, provide) => {
    await provide(new HomePage(page, ai));
  },
});

export { expect } from "intelliwright";
```

`test.extend()` adds fixtures: values that a test receives by naming them in its first parameter. Each test that asks for `homePage` gets a new `HomePage` for its own page. See [Fixtures](../writing-tests/fixtures.md).

## The test

```ts title="e2e/home.e2e.ts"
import { expect, test } from "./fixtures";

test.describe("home page", { tag: "@smoke" }, () => {
  test("shows its main heading", async ({ homePage }) => {
    await homePage.goto();
    await expect(homePage.heading).toBeVisible();
  });
});
```

Tests import `test` and `expect` from `./fixtures`, ask for what they need by name, and `await` every assertion. `toBeVisible()` retries until the heading shows up or the expect timeout, 5 seconds by default, runs out. See [Assertions](../writing-tests/assertions.md).

## Add a test of your own

Say the app has a page at `/notes/new` with a Title field and a Save note button. Add a page object for it:

```ts title="e2e/pages/new-note.page.ts"
import { BasePage } from "intelliwright";

export class NewNotePage extends BasePage {
  readonly path = "/notes/new";
  readonly titleField = this.page.getByLabel("Title");
  readonly saveButton = this.page.getByRole("button", { name: "Save note" });

  async save(title: string) {
    await this.titleField.fill(title);
    await this.saveButton.click();
  }
}
```

Register it next to `homePage`:

```ts title="e2e/fixtures.ts"
import { test as base } from "intelliwright";
import { HomePage } from "./pages/home.page";
import { NewNotePage } from "./pages/new-note.page";

export const test = base.extend<{ homePage: HomePage; newNotePage: NewNotePage }>({
  homePage: async ({ page, ai }, provide) => {
    await provide(new HomePage(page, ai));
  },
  newNotePage: async ({ page, ai }, provide) => {
    await provide(new NewNotePage(page, ai));
  },
});

export { expect } from "intelliwright";
```

Then write the test:

```ts title="e2e/notes.e2e.ts"
import { expect, test } from "./fixtures";

test("a user can save a note", { tag: "@smoke" }, async ({ page, newNotePage }) => {
  const title = `Groceries ${Date.now()}`;
  await newNotePage.goto();
  await newNotePage.save(title);

  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page).toSatisfy("the new note is shown with its title");
});
```

The title includes `Date.now()`, so tests running in parallel never create the same note. The last line is an AI assertion: Jev reads the page and gives the probability that the claim is true, and the assertion passes at 0.7 or above. See [AI assertions](../jev/assertions.md).

## Run it

```bash
npx intelliwright test
```

```text
Running 2 tests using 2 workers

  ✓  e2e/home.e2e.ts:4 › home page › shows its main heading (812ms)
  ✓  e2e/notes.e2e.ts:3 › a user can save a note (2.1s)

  2 passed

  By tag
    @smoke  2 passed

  Slowest
      2.1s  e2e/notes.e2e.ts:3 › a user can save a note
     812ms  e2e/home.e2e.ts:4 › home page › shows its main heading

  Jev  TypeSafe (jev-1.13.0): 1 call, 1,912 input tokens, $0.000080

  Finished in 4.3s

  HTML report: intelliwright-report/index.html. Open it with: npx intelliwright show-report
```

Each test is listed by file, line and title. The `Jev` line counts the calls this run made and what they cost.

A few useful variations:

```bash
npx intelliwright test e2e/notes.e2e.ts      # one file
npx intelliwright test e2e/notes.e2e.ts:3    # the test that starts on line 3
npx intelliwright test --headed              # watch the browser
npx intelliwright test --suite smoke         # tests tagged @smoke
npx intelliwright test --ui                  # run tests from the browser, and watch the results arrive
```

See [Running and selecting tests](../running-tests/selecting-tests.md) for every way to pick tests.

## When a test fails

The terminal prints the error with the lines of code around it, a triage label such as `regression` or `test_bug`, and the folder with the failure's screenshot, trace and logs. After a local run with failures, the HTML report opens in your browser. You can open the last report at any time:

```bash
npx intelliwright show-report
```

See [Reports and artifacts](../running-tests/reports.md) and [Failure triage](../jev/triage.md).
