---
title: Running in CI
description: Run Intelliwright in GitHub Actions or another CI system, with secrets, retries, reports and the locator cache.
---

## GitHub Actions

```yaml title=".github/workflows/e2e.yml"
name: End-to-end tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx intelliwright install chromium --with-deps
      - run: npx intelliwright test
        env:
          TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
          E2E_MEMBER_EMAIL: ${{ secrets.E2E_MEMBER_EMAIL }}
          E2E_MEMBER_PASSWORD: ${{ secrets.E2E_MEMBER_PASSWORD }}
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with:
          name: intelliwright-report
          path: |
            intelliwright-report/
            test-results/
          retention-days: 14
```

- `--with-deps` installs the system libraries the browser needs on a fresh Linux runner.
- `.env.local` isn't in CI, so pass provider keys and test credentials as secrets. Variables set by CI are used as they are.
- Uploading `intelliwright-report/` and `test-results/` keeps the report, screenshots and traces of failed runs. Download the artifact and run `npx intelliwright show-report intelliwright-report`.
- The run exits with code 1 when a test fails, which fails the job.

## A config for CI

```ts title="intelliwright.config.ts"
const ci = Boolean(process.env.CI);

export default defineConfig({
  retries: ci ? 2 : 0,
  workers: ci ? 2 : undefined,
  webServer: {
    command: ci ? "npm run build && npm run start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
  reporters: ci ? ["terminal", "html", "junit"] : ["terminal", "html"],
});
```

- **Retries** turn one-off failures into `flaky` results instead of failed builds, while the summary still lists them. Fix flaky tests rather than relying on retries; see [Fixing flaky tests](flaky-tests.md).
- **Workers** default to half the runner's CPU cores. Lower it if the app under test struggles with parallel load.
- **A production build** is closer to what users get, and usually faster to test than a dev server.
- **JUnit** lets CI systems that read it show each test's result.
- The HTML report never opens by itself when `CI` is set.

## Keep CI fast and cheap

- **Commit `.intelliwright/cache.json`.** [AI actions](../jev/actions.md#the-locator-cache) whose cached locators still match make no Jev calls in CI.
- **Replace `ai.run` with its generated code** once a flow works, as described in [Goal-driven runs](../jev/goals.md#turning-a-run-into-code).
- **Run a smoke suite on every push** and the rest on a schedule, with [named suites](selecting-tests.md#by-named-suite): `npx intelliwright test --suite smoke`.
- **Check the `Jev` line** at the end of the run for the number of calls and the cost.

## Without a key

Pull requests from forks don't get your secrets. Tests that don't use Jev features still run without a key. For tests that do, either tag them, such as `@ai`, and run `--tag "not @ai"` when the key is missing, or use a [mock evaluator](../jev/providers.md#a-mock-for-offline-runs). Failure triage is skipped with a note.

## Other CI systems

The same steps work anywhere Node.js 22 runs:

```bash
npm ci
npx intelliwright install chromium --with-deps
npx intelliwright test --reporter terminal,junit
```

Then publish `test-results/junit.xml` and keep `intelliwright-report/` and `test-results/` as artifacts.
