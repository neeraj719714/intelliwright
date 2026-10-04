---
title: Running and selecting tests
description: Run the whole suite or pick tests by file, line, tag, title, named suite or last run's failures, and control workers, retries and the browser.
---

```bash
npx intelliwright test
```

runs every test. Everything below narrows that down or changes how tests run. When you combine filters, a test must match all of them.

## By file and line

```bash
npx intelliwright test e2e/notes.e2e.ts e2e/search/
npx intelliwright test notes
npx intelliwright test e2e/notes.e2e.ts:12
```

- A path to a file or folder runs the tests in it.
- A filter that isn't an existing path matches every test file whose path contains it, so `notes` runs `e2e/notes.e2e.ts` and `e2e/notes/sharing.e2e.ts`.
- `:line` runs the test whose `test(` call starts on that line, or every test in a `describe` that starts on that line. A line inside a test's body matches nothing.

## By tag

```bash
npx intelliwright test --tag @smoke
npx intelliwright test --tag "@smoke and not @slow"
npx intelliwright test --tag "(@auth or @billing) and not @flaky"
```

Tag expressions combine tags with `and`, `or`, `not` and parentheses. `not` binds tightest, then `and`, then `or`. Tags compare case-insensitively. See [Tags](../writing-tests/basics.md#tags) for how tests get them.

## By named suite

Name tag expressions in the config:

```ts title="intelliwright.config.ts"
export default defineConfig({
  suites: {
    smoke: "@smoke",
    nightly: "@regression or @slow",
    guest: "not @member",
  },
});
```

```bash
npx intelliwright test --suite nightly
```

`--suite` and `--tag` can be used together; a test must match both.

## By title

```bash
npx intelliwright test --grep "saves a note"
npx intelliwright test --grep "^search" --grep-invert "no results"
```

`--grep` runs tests whose full title matches a regular expression, and `--grep-invert` skips them. The full title is the `describe` titles, the test title and the tags, joined by spaces, so `--grep @smoke` works too. Matching is case-sensitive.

## Listing without running

```bash
npx intelliwright test --suite smoke --list
```

```text
Listing tests:
  e2e/home.e2e.ts:4 › home page › shows its main heading @smoke
  e2e/notes.e2e.ts:3 › a user can save a note @smoke
Total: 2 tests in 2 files
```

Tags that aren't already in a title are shown after it. When some of the tests [start signed in](../writing-tests/signing-in.md), a last line names the roles the run would sign in as, such as `Signs in first as: member`.

## Rerunning failures

```bash
npx intelliwright test --last-failed
```

runs only the tests that failed in the previous run, read from `test-results/.last-run.json`. Tests that were skipped because their sign-in failed count as failed here.

## Focused tests

When any selected test is marked `test.only` or is inside `test.describe.only`, only the focused tests run.

## How tests run

| Flag | Config | Default | What it does |
| --- | --- | --- | --- |
| `--headed` | `headless: false` | Headless | Shows the browser while tests run. |
| `-j`, `--workers <count>` | `workers` | Half the CPU cores | How many worker processes run test files in parallel. |
| `--retries <count>` | `retries` | 0 | Extra attempts for a failing test. |
| `--timeout <ms>` | `timeout` | 30000 | Milliseconds per test. 0 means no limit. |
| `--reporter <names>` | `reporters` | `terminal,html` | Comma-separated reporters: `terminal`, `html`, `json`, `junit`. |
| `--base-url <url>` | `baseURL` | | Runs against another URL. See [Starting your app](web-server.md#another-environment). |
| `--update-cache` | | | Resolves every [AI action](../jev/actions.md#the-locator-cache) again instead of using cached locators. |
| `-c`, `--config <file>` | | `intelliwright.config.*` in the current folder | Uses another config file. |

The run never starts more workers than there are test files to run.

## Choosing a browser

Tests run in Chromium unless the config says otherwise:

```ts title="intelliwright.config.ts"
export default defineConfig({
  browser: "firefox",
  launchOptions: { slowMo: 100 },
});
```

`browser` is `chromium`, `firefox` or `webkit`, and each must be installed first, such as with `npx intelliwright install firefox`. `launchOptions` go to Playwright's `browserType.launch()`, for example `channel: "chrome"` to use an installed Google Chrome. A run uses one browser; to test several, run the suite once per config with `-c`.

Browser context options, such as the viewport, locale, time zone, permissions or extra HTTP headers, go in `use`:

```ts title="intelliwright.config.ts"
export default defineConfig({
  use: {
    viewport: { width: 1280, height: 800 },
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
});
```

`test.use()` sets them for one file or `describe`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every test passed, or was skipped or flaky. Also when `--last-failed` finds nothing to rerun. |
| 1 | A test failed, a file failed to load, no tests were found or matched, or the config is invalid. |
| 130 | The run was interrupted with Ctrl+C. |
