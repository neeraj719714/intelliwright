---
title: Fixing flaky tests
description: Common causes of tests that fail and then pass on a retry, and how to fix each one.
---

A test is flaky when it fails, then passes on a retry with no code change. Intelliwright marks these `flaky` in the summary and the report, and [triage](../jev/triage.md) can label a final failure `flaky` too. Find the cause before changing anything: the report's steps, trace, and console and network logs show what the page was doing when the step failed.

## Common causes

**Asserting before the page is ready.** `expect(await locator.textContent()).toBe("Saved")` reads once and fails if the content arrives later. Use an assertion that retries: `await expect(locator).toHaveText("Saved")`.

**Fixed sleeps.** `page.waitForTimeout(1000)` is too long on a fast machine and too short on a slow one. Wait for the specific thing instead: a locator, a URL, or a response.

**Waiting for the network to go idle.** Analytics, polling and websockets keep the network busy, or make it idle at the wrong moment. Wait for the one response the step needs, starting the wait before the action that triggers it:

```ts
const saved = page.waitForResponse((response) => response.url().endsWith("/api/notes") && response.ok());
await newNotePage.save(title);
await saved;
```

**Navigation races.** After a click that navigates, assert on the new page with `await expect(page).toHaveURL(…)` or a locator on the new page before acting on it.

**Overlays in the way.** Cookie banners, toasts and modals can cover an element. Dismiss them in a fixture or a `beforeEach` hook, or wait for them to go with `await expect(toast).not.toBeVisible()`.

**Animations.** Clicking an element that is still moving can hit something else. Wait for the final state, such as the dialog being visible, before acting.

**Shared or leftover data.** Two tests that both create "Test note" collide, especially across workers. Give every record a unique name, such as one with `Date.now()` in it, and never depend on records another test made.

**Test order.** A test that passes alone but fails in the suite usually depends on state another test left behind. Each test gets a fresh browser context; anything outside it, such as data on the server, must be set up by the test itself.

**Backend data that changes.** Asserting exact counts or text from live data breaks when the data changes. Mock the endpoint with `page.route` when the test isn't about that data, or assert the shape, such as how many columns or a date format, instead of the values.

**Time and locale.** Dates, time zones and number formats differ between machines and CI. Set `locale` and `timezoneId` in the config's `use`, and avoid asserting the current date.

**Too tight a timeout.** If a step is legitimately slow, raise that step's timeout, such as `toBeVisible({ timeout: 10_000 })`, rather than the global one, and only after ruling out the causes above.

**AI checks near the threshold.** A `toSatisfy` claim that passes at 0.72 and fails at 0.68 is too vague. Make it one concrete fact, or check it with a fixed locator and `toHaveText`.

## Before you call it fixed

- The test passes several times in a row with no retries: `npx intelliwright test e2e/notes.e2e.ts --retries 0`.
- It passes with more workers: `--workers 4`.
- No `waitForTimeout` or other sleep was added.
- When the fix is about finding or waiting for an element, it's in the page object, so every test that uses it benefits.
