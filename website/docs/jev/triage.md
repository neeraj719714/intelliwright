---
title: Failure triage
description: Every failing test gets a label, regression, test_bug, flaky or environment, from rules or from Jev.
---

When a test fails for the last time, after any retries, Intelliwright labels the likely cause:

| Label | Meaning | What to do |
| --- | --- | --- |
| `regression` | The app behaves differently from what the test expects, and the test is right. | Fix the app. Don't change the test to make it pass. |
| `test_bug` | A wrong locator, a wrong expected value, or a wrong assumption about the app. | Fix the test or the page object. |
| `flaky` | Timing: the page wasn't ready, or a slow response or an animation got in the way. | See [Fixing flaky tests](../running-tests/flaky-tests.md). |
| `environment` | A server or service is down or unreachable, a network or third-party failure, or missing configuration. | Check that the app and its services are up. |

The label is a starting point for reading the failure, not a verdict. Check it against the error, the screenshot and the trace.

## Where labels come from

1. **Rules, with no Jev call.** When the error shows the app couldn't be reached, such as `net::ERR_CONNECTION_REFUSED` for the `baseURL` origin, the label is `environment`.
2. **Retries, with no Jev call.** A test that failed and then passed on a retry is `flaky`.
3. **Jev, otherwise.** Jev chooses the cause and rates the severity from 0 to 3: cosmetic, minor (there is a workaround), major (a feature is broken), or blocking (people can't continue).

Triage happens while the failed test's page is still open, so Jev sees the page as it was.

## What Jev is given

- the test's title path;
- the first error's message, up to 2,000 characters, and up to 6 lines of its stack;
- the last 6 steps, with the error of any step that failed;
- the last 10 console errors and uncaught page errors;
- the last 10 failed requests, as method, URL and status;
- the page state, when the page is still open.

Password values are masked, and your `ai.redact` rules apply: regular expressions to all of it, and selectors to the page state.

## Where labels show up

In the terminal, under each failure and in the summary:

```text
  1) e2e/checkout.e2e.ts:8 › checkout › pays by card

    ...

    Triage: regression (86%), severity 2.0 of 3. Labeled by Jev (TypeSafe) from the error, steps, logs and page.

    Artifacts: test-results/e2e-checkout-e2e-checkout-pays-by-card-3f2a1c

  1 failed
    e2e/checkout.e2e.ts:8 › checkout › pays by card [regression]
```

Labels also appear in the HTML report, the JSON report and the JUnit report's `system-out`.

## Cost and turning it off

Triage makes one request per failing test, and none for failures labeled by rules or retries. Turn it off with:

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: { triage: false },
});
```

Without a provider, triage is skipped, and the summary says so: `Triage was skipped because no Jev provider is configured.` If a triage request fails, the run goes on, and the summary notes why.
