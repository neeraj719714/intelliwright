# Intelliwright

End-to-end tests for web apps, with page objects and Jev-powered checks, actions and failure triage.

Intelliwright runs tests in real browsers through [Playwright](https://playwright.dev). You write them with page objects, and [Jev](https://docs.typesafe.ai/introduction), TypeSafe AI's decision model, lets a test check the page in plain English, act on an element by describing it, work towards a goal, and explain why it failed.

```ts
import { expect, test } from "./fixtures";

test("a user can save a note", async ({ page, newNotePage }) => {
  await newNotePage.goto();
  await newNotePage.save("Groceries");

  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page).toSatisfy("the new note is shown with its title");
});
```

- **A test runner and command line.** Test files run in parallel worker processes, failing tests can be retried, and you pick tests by file, line, tag, title or named suite.
- **An API you may already know.** `test`, `expect`, `test.describe`, hooks and fixtures work like Playwright Test, and the `page` fixture is a Playwright `Page`.
- **Page objects.** `BasePage` and `test.extend()` make page objects the normal way to write tests, and `intelliwright init` scaffolds them.
- **Jev features, all optional:** plain-English assertions, actions by description cached as readable locators, goal-driven runs that hand back Playwright code, and failure triage.
- **Sign in once per run** with `test.auth()`, and start tests already signed in.
- **Reports:** a terminal summary, a self-contained HTML report with screenshots, traces and every AI decision, and JSON and JUnit files for CI.
- **A skill for AI coding agents**, so Cursor and Claude Code write tests the same way you do.

## Requirements

- Node.js 22 or newer.
- A web app reachable over HTTP: a local dev server, a staging site or a deployed URL.
- For Jev features, a key from one Jev provider: TypeSafe, Vercel AI Gateway, OpenRouter or Cloudflare Workers AI. Tests that don't use them run without one.

## Getting started

```bash
npm install --save-dev intelliwright
npx intelliwright init
npx intelliwright install
```

`init` creates `intelliwright.config.ts`, a page object in `e2e/pages/`, `e2e/fixtures.ts` and a first test. It also adds test output to `.gitignore` and installs the agent skill. It never overwrites a file, and never writes an API key. `install` downloads Chromium; name `firefox` or `webkit` to get those, and add `--with-deps` on a fresh Linux machine.

Put a Jev key in `.env.local`, next to the config, and keep that file out of git:

```bash
TYPESAFE_API_KEY=your-key
```

Then run the tests:

```bash
npx intelliwright test
```

With `webServer` set in the config, Intelliwright starts your app, waits for it, runs the tests, and stops it again.

## Writing tests

A page object holds the locators and actions for one page:

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

Fixtures hand page objects to tests by name:

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

The setup callback is called `provide` rather than `use`, because React's hooks lint rule treats any call to `use()` as a hook. Code after `await provide(value)` runs as teardown. If your `tsconfig.json` enables `noImplicitOverride`, mark `path` and `waitUntilReady()` with `override`.

Besides Jest's matchers, `expect` has page matchers that wait and retry: `toBeVisible`, `toBeInViewport`, `toHaveText`, `toHaveCount`, `toHaveURL` and `toHaveTitle`. Always `await` them.

## Jev features

Jev answers typed questions about the page, and every answer is a probability. Intelliwright sends it the URL, the title and Playwright's ARIA snapshot of the page, never a screenshot. Password fields are always masked, and `ai.redact` masks anything else you name.

**Assertions** check claims about meaning rather than exact text. They pass at `ai.minProbability`, 0.7 by default:

```ts
await expect(page).toSatisfy("the new note is shown with its title");
await expect(page).toSatisfyAll(["the cart shows 3 items", "a Checkout button is visible"]);
await expect(page.getByRole("alert")).toScore(
  "How clearly does the message explain what went wrong?",
  ["Not at all", "Vaguely", "Clearly", "Very clearly"],
  { atLeast: 2 },
);
```

**Actions** find an element from a description. The result is cached in `.intelliwright/cache.json` as an ordinary Playwright locator, so later runs skip Jev until the page changes:

```ts
await ai.click("the Sign in button in the header");
await ai.fill("the search field", "groceries");
const card = await ai.locate("the first note in the list");
```

**Goal-driven runs** work towards a goal one click or fill at a time. Jev never types text: values come from `data`. The result includes the same flow as fixed Playwright code, to paste into a page object once the run works:

```ts
const result = await ai.run("save a new note with the given title and body", {
  data: { title: "Groceries", body: "Milk, eggs and bread." },
  avoid: ["the Delete button"],
});
console.log(result.code);
```

**Questions** of your own go through `ai.evaluate`, with typed answers for yes/no, choice and score questions.

**Failure triage** labels each final failure as `regression`, `test_bug`, `flaky` or `environment`, in the terminal and in the report.

## Signing in

Sign in once per run in a setup file, and save the browser's state for the tests that need it:

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

Tests pick a role with `use: { auth: "member" }` in the config, or `test.use({ auth: "member" })` in a file or `describe`. The state is saved to `.intelliwright/auth/<role>.json`, which must never be committed.

## Running tests

| Command | What it does |
| --- | --- |
| `npx intelliwright test` | Runs every test. |
| `npx intelliwright test e2e/notes.e2e.ts:12` | Runs the test, or `describe`, that starts on line 12. |
| `npx intelliwright test --tag "@smoke and not @slow"` | Runs tests whose tags match. |
| `npx intelliwright test --suite smoke` | Runs a named suite from the config. |
| `npx intelliwright test --grep "saves a note"` | Runs tests whose title matches. |
| `npx intelliwright test --last-failed` | Reruns the tests that failed last time. |
| `npx intelliwright test --list` | Lists the matching tests without running them. |
| `npx intelliwright test --headed` | Shows the browser. |
| `npx intelliwright test --base-url https://staging.example.com` | Runs against another environment. |
| `npx intelliwright show-report` | Opens the last HTML report. |

Failures save a trace, screenshots, an ARIA snapshot, and the console and network logs to `test-results/`. The HTML report opens by itself after a local run with failures, and never in CI.

## Configuration

```ts
// intelliwright.config.ts
import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "./e2e",
  baseURL: "http://localhost:3000",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  retries: process.env.CI ? 2 : 0,
  ai: { provider: "typesafe" },
  suites: { smoke: "@smoke" },
  reporters: ["terminal", "html", "junit"],
});
```

## Providers

| `ai.provider` | Environment variables | Default model |
| --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `jev-latest` |
| `vercel` | `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` | `typesafe-ai/jev` |
| `openrouter` | `OPENROUTER_API_KEY` | `~typesafe/jev-latest` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | `typesafe/jev` |

Without `ai.provider`, Intelliwright uses the first provider whose key is set, in this order. It also accepts any host that implements TypeSafe's System One API, your own `evaluate` function, an AI SDK model through `intelliwright/ai-sdk`, and a local mock from `intelliwright/testing`.

## AI coding agents

`intelliwright init` copies a skill into `.cursor/skills/intelliwright/` and `.claude/skills/intelliwright/`. Agents read it when they write, fix or review these tests: where files go, page object rules, locator priority, waiting, test data, signing in, when to use Jev, and how to fix flaky tests. Pass `--no-skill` to leave it out.

## Development

```bash
npm install
npm run build
node dist/cli.js install chromium
npm test             # unit and integration tests
npm run typecheck
npm run test:live    # real Jev requests; needs a provider key in .env.local
npm run test:pack    # packs the tarball and installs it in a scratch project
```

The documentation site is a Docusaurus project in the `website/` folder. Run `npm install` and `npm start` there to read it locally.

## License

MIT
