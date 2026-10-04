---
name: intelliwright
description: Write, fix and review end-to-end tests that run on Intelliwright, with page objects, fixed locators first, waiting assertions, and Jev-powered checks and actions. Use when creating or editing *.e2e.ts tests, page objects in e2e/pages, e2e/fixtures.ts or intelliwright.config files, when a test fails or is flaky, or when choosing between a fixed locator and an ai.* action.
---

# Writing Intelliwright tests

Intelliwright runs end-to-end tests in real browsers. Tests import `test` and
`expect` from `intelliwright` (or from the project's `e2e/fixtures.ts`), use
page objects for everything on the page, and can ask Jev, a decision model,
plain-English questions about the page.

Read [page-objects.md](page-objects.md) before writing a page object, and
[flakiness.md](flakiness.md) before fixing a flaky test.

## Where things go

- Page objects: `e2e/pages/<name>.page.ts`, one class per page or large
  component. Never a root `pages/` folder; frameworks such as Next.js treat it
  as routes.
- Fixtures that hand page objects to tests: `e2e/fixtures.ts`.
- Tests: `e2e/**/*.e2e.ts`, so other test runners don't pick them up.
- Sign-ins: `e2e/auth.setup.ts`.
- Config: `intelliwright.config.ts` at the project root.

## A complete example

```ts
// e2e/pages/new-note.page.ts
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

```ts
// e2e/fixtures.ts
import { test as base } from "intelliwright";
import { NewNotePage } from "./pages/new-note.page";

export const test = base.extend<{ newNotePage: NewNotePage }>({
  newNotePage: async ({ page, ai }, provide) => {
    await provide(new NewNotePage(page, ai));
  },
});
export { expect } from "intelliwright";
```

```ts
// e2e/new-note.e2e.ts
import { expect, test } from "./fixtures";

test.describe("writing a note", { tag: "@notes" }, () => {
  test("a user can save a note", { tag: "@smoke" }, async ({ page, newNotePage }) => {
    const title = `Groceries ${Date.now()}`;
    await newNotePage.goto();
    await newNotePage.save(title);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
```

The fixture callback is called `provide`, never `use`. React's hooks lint rule
treats any call to `use(...)` as a hook, so `use` fails linting in React
projects. Code after `await provide(value)` runs as teardown.

## Page object rules

- Locators are `readonly` fields. Methods are named after what the user is
  trying to do: `save(title)`, `signIn(email)`, not `clickButton()`.
- Page objects contain no assertions, except in `waitUntilReady()`, which
  `goto()` calls after navigating.
- Tests never use raw selectors. If a test needs an element, add it to the page
  object.
- Test files have no top-level side effects: no navigation, no data setup, no
  `await` outside `test`, hooks and fixtures.

## Choosing locators

Use the first of these that is unique and stable:

1. Test id: `page.getByTestId("save")` (the attribute is `testIdAttribute`,
   `data-testid` by default).
2. Role and accessible name: `page.getByRole("button", { name: "Save" })`.
3. Label: `page.getByLabel("Email")`.
4. Placeholder: `page.getByPlaceholder("Search")`.
5. Text: `page.getByText("No results")`.

Never use CSS classes, generated ids, or XPath that depends on layout. To
narrow down, chain from a landmark:
`page.getByRole("navigation").getByRole("link", { name: "Home" })`.

## Waiting

- Use assertions that wait and retry on their own:
  `await expect(locator).toBeVisible()`, `toHaveText`, `toHaveCount`,
  `toBeInViewport`, `await expect(page).toHaveURL(...)`, `toHaveTitle`.
  Always `await` them.
- Never use `page.waitForTimeout` or fixed sleeps.
- When a step depends on the backend, wait for that response, not for the
  network to go idle:

  ```ts
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/notes") && response.ok());
  await newNotePage.save(title);
  await saved;
  ```

- Playwright actions such as `click` and `fill` already wait for the element
  to be visible, enabled and stable.

## Isolation and test data

- Each test creates its own data with unique names, such as a title with
  `Date.now()` in it. Never rely on data another test created.
- No test may depend on the order tests run in; workers run files in parallel.
- Don't sign in through the UI in every test; see "Signing in" below.
- When a test isn't about some backend data, mock it with `page.route` so the
  test doesn't break when that data changes. When the data matters, assert its
  shape (how many rows, which columns, a date format), not exact values that
  change.

## Signing in

Sign in once per run, not in every test. Give each role a sign-in in a setup
file such as `e2e/auth.setup.ts`:

```ts
// e2e/auth.setup.ts
import { expect, test } from "./fixtures";

test.auth("member", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(process.env.E2E_MEMBER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_MEMBER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});
```

- Tests pick a role with `use: { auth: "member" }` in the config, or
  `test.use({ auth: "admin" })` in a file or describe.
  `test.use({ auth: null })` starts signed out.
- Each sign-in runs once per run, in a fresh signed-out browser, before the
  tests that need it. Its cookies and storage are saved to
  `.intelliwright/auth/<role>.json`, which must never be committed.
- End every sign-in with an assertion that proves it worked, so the state is
  saved only after the session cookies are set.
- Read credentials from environment variables, such as `.env.local`, and use
  dedicated test accounts. Never write a password in a test file.
- If the app has a sign-in API, `page.request` shares cookies with the page,
  so `await page.request.post("/api/sign-in", { data })` inside `test.auth`
  is faster than the form.
- Setup files hold only `test.auth()` sign-ins, one per role.

## Jev-powered checks and actions

Prefer fixed locators and normal assertions. Reach for AI when the thing to
check is about meaning, or the element is hard to target with a fixed locator.

Checks:

```ts
await expect(page).toSatisfy("the new note is shown with its title");
await expect(page).toSatisfyAll([
  "the cart shows 3 items",
  "the total is shown in dollars",
  "a Checkout button is visible",
]);
await expect(page).not.toSatisfy("an error message is shown");
await expect(page.getByRole("alert")).toScore(
  "How clearly does the message explain what went wrong?",
  ["Not at all", "Vaguely", "Clearly", "Very clearly"],
  { atLeast: 2 },
);
```

- Each claim is one checkable fact. Split "the cart has 3 items and a total"
  into two claims.
- Group claims about the same page into one `toSatisfyAll`: one request
  instead of several, and the failure message lists every claim.
- Pass a locator to scope a claim to one element.
- Keep the default threshold (`ai.minProbability`, 0.7). Change it only when
  labeled examples show a different value works better.

Actions, on the `ai` fixture or `this.ai` in a page object:

```ts
await ai.click("the Sign in button in the header");
await ai.fill("the search field", "groceries");
await ai.select("the sort order menu", "newest");
await ai.check("the terms checkbox");
await ai.hover("the user menu");
const card = await ai.locate("the first note in the list");
```

- Jev picks among the elements on the page; the result is cached in
  `.intelliwright/cache.json`, so later runs make no Jev call until the page
  changes. Commit the cache to keep CI fast. `--update-cache` resolves every
  action again.
- Describe the element the way a person would: its text, role and where it
  is.

Goals:

```ts
const result = await ai.run("create an account on the Pro plan", {
  data: { name: "Jane Doe", email: `jane+${Date.now()}@example.com` },
  avoid: ["the Delete account button"],
  maxSteps: 8,
});
```

- Jev never writes text: values for text fields come from `data`.
- The run stays on the base URL's origin and throws if it can't reach the
  goal. Once a run works, copy `result.code` (also in the report) into a page
  object method and replace `ai.run`, so the test becomes deterministic.

Ask anything else with `ai.evaluate`:

```ts
const { plan, signedIn } = await ai.evaluate({
  plan: { type: "choice", instructions: "Which plan is selected?", criteria: { free: "The Free plan", pro: "The Pro plan" } },
  signedIn: { type: "boolean", instructions: "Is a user signed in?" },
});
expect(plan.choice).toBe("pro");
expect(signedIn.probability).toBeGreaterThan(0.7);
```

Password fields are always masked before the page is sent. Mask other private
text with `ai.redact` in the config: regexes for patterns, selectors for
elements.

## Tags and suites

- Tag with `{ tag: "@smoke" }` or `{ tag: ["@smoke", "@auth"] }` on `test` or
  `test.describe`; tests inherit their describe's tags.
- Conventions: `@smoke` for the few tests that must pass on every change,
  `@regression` for the wider net, `@slow` for long tests, plus one tag per
  feature such as `@auth` or `@search`.
- Run them:
  - `npx intelliwright test --tag "@smoke and not @slow"`
  - `npx intelliwright test --suite smoke` (named in the config's `suites`)
  - `npx intelliwright test e2e/new-note.e2e.ts:12` for one test
  - `--grep "title words"`, `--list` to see what would run,
    `--last-failed` to rerun failures.

## When a test fails

1. Read the failure in the terminal: the error, the code frame, the triage
   label (regression, test_bug, flaky or environment), and the artifact folder.
2. Open the report with `npx intelliwright show-report`: steps, AI decisions,
   screenshot, console and network logs, and the trace.
3. A `regression` is an app bug: don't change the test to pass. A `test_bug`
   needs a test or page object fix. For `flaky`, follow
   [flakiness.md](flakiness.md). For `environment`, check that the app and
   its services are up.

## Review checklist

- Locators live in page objects and follow the priority above.
- No `waitForTimeout`, no fixed sleeps, no dependence on test order.
- Each test creates its own data and cleans up if the app needs it.
- AI claims are single facts; claims about one page are grouped.
- `ai.run` is used to explore, then replaced with the generated code.
- Changes to `.intelliwright/cache.json` match the page changes in the diff.
