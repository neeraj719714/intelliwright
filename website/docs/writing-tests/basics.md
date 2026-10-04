---
title: Test basics
description: Test files, test and describe, tags, hooks, steps, skipping, timeouts, retries and test info.
---

## Test files

Intelliwright runs the files in `testDir` (`e2e` by default) that match `testMatch` (`**/*.e2e.{ts,js,mts,mjs,cts,cjs}` by default). They can be TypeScript or JavaScript, ES modules or CommonJS, and run without a build step. Use `testIgnore` to leave some out. Files that end in `.setup.ts` hold [sign-ins](signing-in.md) and are never run as tests.

To build the list of tests, Intelliwright imports every test file once without running any test bodies. Keep test files free of top-level side effects: no navigation, no data setup, and no `await` outside tests, hooks and fixtures.

## Declaring tests

```ts title="e2e/notes.e2e.ts"
import { expect, test } from "intelliwright";

test("shows the notes page", async ({ page }) => {
  await page.goto("/notes");
  await expect(page).toHaveTitle(/Notes/);
});
```

`test(title, body)` declares a test, and `test(title, details, body)` adds details such as tags. The body's first parameter names the [fixtures](fixtures.md) the test uses, destructured, as in `async ({ page, ai }) => …`. Intelliwright reads those names to set up only what the test needs, so the parameter has to be destructured: `async (fixtures) => …` is an error. A test that needs no fixtures can take no parameters. The second parameter is the test's [test info](#test-info-and-attachments).

In most projects, tests import `test` and `expect` from `e2e/fixtures.ts` instead, so they also get the project's page objects.

## Groups

```ts
test.describe("search", () => {
  test("finds a note by title", async ({ page }) => {
    // ...
  });

  test.describe("with no results", () => {
    test("says nothing matched", async ({ page }) => {
      // ...
    });
  });
});
```

A `describe` body must be synchronous. Register the tests directly inside it; an `async` describe throws.

## Tags

```ts
test.describe("checkout", { tag: "@checkout" }, () => {
  test("pays by card", { tag: ["@smoke", "@payments"] }, async ({ page }) => {
    // ...
  });

  test("applies a coupon @slow", async ({ page }) => {
    // ...
  });
});
```

- Tags start with `@`. Pass one as a string or several as an array.
- Tests inherit the tags of their `describe` blocks, so "pays by card" has `@checkout`, `@smoke` and `@payments`.
- Words that start with `@` in a title count as tags too.

Run tests by tag with `--tag "@smoke and not @slow"`, or name tag expressions as suites in the config. See [Running and selecting tests](../running-tests/selecting-tests.md#by-tag). A common set of tags is `@smoke` for the few tests that must pass on every change, `@regression` for the wider net, `@slow` for long tests, and one tag per feature, such as `@auth` or `@search`.

Details can also carry annotations, which are saved with the results and written to the JSON report:

```ts
test("exports notes as CSV", { annotation: { type: "issue", description: "https://example.com/issues/42" } }, async ({ page }) => {
  // ...
});
```

## Hooks

```ts
test.beforeEach(async ({ page }) => {
  await page.goto("/notes");
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== "passed") {
    await testInfo.attach("local storage", { body: await page.evaluate(() => JSON.stringify(localStorage)) });
  }
});
```

- `beforeEach` and `afterEach` run around every test in the file, or in the `describe` that declares them. They receive the same fixtures as the test, plus its test info. Outer `beforeEach` hooks run first, and outer `afterEach` hooks run last.
- `afterEach` hooks run even when the test failed or timed out. They get a time budget of their own, as long as the test timeout, and `testInfo.status` is already set when they start. That makes them the place to delete data a test created.
- `beforeAll` and `afterAll` run once for the file or `describe`: before its first test and after its last, in the worker that runs the file. They can use only the `browser` and `browserName` fixtures, and get `{ workerIndex }` as their second parameter. When a `beforeAll` hook fails, the tests it covers fail without running.

Here is a cleanup pattern for data the app creates:

```ts
const created: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of created.splice(0)) {
    await page.request.delete(`/api/notes/${id}`);
  }
});
```

`page.request` shares cookies with the page, so it acts as the same signed-in user.

## Steps

Hooks, assertions and Jev calls show up as steps in the report on their own. Wrap other work in `test.step()` to give it a title:

```ts
test("checks out", async ({ cartPage, checkoutPage }) => {
  await test.step("add two items", async () => {
    await cartPage.add("Milk");
    await cartPage.add("Eggs");
  });
  const orderId = await test.step("pay", () => checkoutPage.payByCard());
  // ...
});
```

`test.step()` returns whatever its body returns. Steps can nest.

## Focusing and skipping

| Call | Effect |
| --- | --- |
| `test.only(title, body)` | Runs only this test, and other focused tests. |
| `test.describe.only(title, body)` | Runs only the tests in this group, and other focused tests. |
| `test.skip(title, body)` | Declares a test that is skipped. |
| `test.describe.skip(title, body)` | Skips every test in the group. |
| `test.skip()` inside a test | Skips the rest of the test. |
| `test.skip(condition, reason)` inside a test | Skips the rest of the test when `condition` is true. |
| `test.skip(condition, reason)` inside a `describe` or at the top of a file | Skips the tests in that group or file when `condition` is true. |
| `test.fixme(…)` | The same as `test.skip(…)`, marked as something to fix. |

```ts
test("uploads a photo", async ({ browserName, page }) => {
  test.skip(browserName === "webkit", "WebKit can't read the clipboard here");
  // ...
});
```

The reason is shown next to the skipped test in the terminal and in the JUnit report. Remember to remove `.only` before you commit.

## Timeouts

| Timeout | Default | Covers | Change it with |
| --- | --- | --- | --- |
| Test | 30 seconds | The test body, its `beforeEach` hooks and fixture setup | `timeout` in the config, `--timeout`, or `test.setTimeout(ms)` inside a test |
| `afterEach` hooks | The test timeout | All `afterEach` hooks of one test, after it ends | The test timeout |
| Assertion | 5 seconds | One page or AI assertion | `expect.timeout` in the config, or `{ timeout }` on the assertion |
| Action | None | One Playwright action, such as `click` | `use.actionTimeout` in the config, or `{ timeout }` on the action |
| Navigation | None | One navigation, such as `page.goto` | `use.navigationTimeout` in the config, or `{ timeout }` on the call |

A timeout of `0` means no limit. Fixture teardown, which runs after `afterEach`, has a limit of 30 seconds of its own. When a test times out, `testInfo.signal` aborts, which also cancels its Jev requests.

```ts
test("imports a large file", async ({ page }) => {
  test.setTimeout(120_000);
  // ...
});
```

## Retries

Set `retries` in the config, or pass `--retries 2`, to run a failing test again. Each attempt gets fresh fixtures, a new browser context and its own artifact folder. A test that fails and then passes on a retry is reported as **flaky**: it doesn't fail the run, but the summary lists it. See [Fixing flaky tests](../running-tests/flaky-tests.md).

## Parallel runs and isolation

Test files run in parallel, one file per worker process at a time. The number of workers defaults to half the CPU cores; change it with `workers` or `--workers`. Tests in one file run in order, in the same worker.

Each test gets a new browser context, so cookies, local storage and open pages never carry over from another test. The browser itself is shared by the tests in a worker. Anything outside the browser, such as data on your server, is up to the test: create what it needs with unique names, and never depend on data another test made or on the order tests run in.

## Test info and attachments

The second parameter of a test, a hook or a fixture is the test's `TestInfo`. Inside helpers and page objects, `test.info()` returns the same object while a test is running.

| Property or method | What it is |
| --- | --- |
| `title`, `titlePath` | The test's title, and the `describe` titles followed by the test's title. |
| `file`, `line`, `column` | Where the test is declared. |
| `tags` | The test's tags, inherited ones included. |
| `retry` | 0 on the first attempt, 1 on the first retry, and so on. |
| `workerIndex` | Which worker runs the test. |
| `status` | `passed`, `failed`, `timedOut` or `skipped`, set once the test body ends. |
| `timeout`, `setTimeout(ms)` | The test timeout, and a way to change it. |
| `signal` | An `AbortSignal` that aborts when the test times out. |
| `annotations` | Annotations from the test's details, plus skips. |
| `skip(condition?, reason?)` | Skips the rest of the test. |
| `outputDir`, `outputPath(...segments)` | This attempt's artifact folder, created on first use, and a path inside it. |
| `attachments`, `attach(name, options)` | Files and text attached to the result. |

Attachments appear in the HTML report:

```ts
test("generates an invoice", async ({ page }, testInfo) => {
  // ...
  await testInfo.attach("invoice", { path: downloadPath });
  await testInfo.attach("request body", { body: JSON.stringify(payload, null, 2), contentType: "application/json" });
});
```

`attach` takes a `path` to a file, which is copied into the attempt's folder, or a `body` of text or bytes. `contentType` is guessed from the file extension when you leave it out.
