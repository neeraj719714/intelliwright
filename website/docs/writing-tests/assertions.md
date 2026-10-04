---
title: Assertions
description: Jest's expect plus page matchers that wait and retry, and how they compare with Playwright's.
---

`expect` is Jest's `expect` with three kinds of matchers:

- every Jest matcher, such as `toBe`, `toEqual`, `toContain` and `toMatch`, which check a value once;
- six page matchers that wait and retry, described on this page;
- three [AI matchers](../jev/assertions.md), `toSatisfy`, `toSatisfyAll` and `toScore`, which ask Jev.

```ts
import { expect } from "intelliwright";

await expect(page.getByRole("alert")).toHaveText("Note saved");
await expect(page.getByRole("listitem")).toHaveCount(3);
await expect(page).toHaveURL("/notes");
expect(await response.json()).toEqual({ ok: true });
```

Always `await` page and AI matchers. Without `await`, the test moves on before the check finishes, and a failure can be lost.

## Page matchers

| Matcher | Called on | Passes when |
| --- | --- | --- |
| `toBeVisible()` | Locator | The locator matches exactly one element, and it is visible. |
| `toBeInViewport({ ratio })` | Locator | The element intersects the viewport. With `ratio`, at least that share of it, from 0 to 1. |
| `toHaveText(expected)` | Locator | The element's text matches a string or a regular expression. With an array, the locator matches that many elements, and each one's text matches in order. |
| `toHaveCount(count)` | Locator | The locator matches exactly `count` elements. |
| `toHaveURL(expected)` | Page | The page URL matches a string or a regular expression. |
| `toHaveTitle(expected)` | Page | The page title matches a string or a regular expression. |

Every page matcher takes `{ timeout }` as its last argument. `toHaveText` also takes `ignoreCase`, and `useInnerText` to compare `innerText` instead of `textContent`.

```ts
await expect(page.getByRole("dialog", { name: "Send feedback" })).not.toBeVisible();
await expect(page.getByRole("button", { name: "Load more" })).toBeInViewport({ ratio: 0.5 });
await expect(page.getByRole("listitem")).toHaveText(["Milk", "Eggs", /^Bread/]);
await expect(page.getByRole("status")).toHaveText("saved", { ignoreCase: true, timeout: 10_000 });
await expect(page).toHaveTitle(/Notes/);
```

## How page matchers wait

A page matcher checks the page, and if the check fails, checks again after 100, 250 and 500 milliseconds, then every second, until it passes or the timeout runs out. The timeout is `expect.timeout` from the config, 5 seconds by default, or the `timeout` you pass.

With `.not`, the matcher waits until the opposite holds. `expect(locator).not.toBeVisible()` passes once the element is hidden or gone.

`toBeVisible`, `toBeInViewport` and a single-value `toHaveText` need the locator to match one element. When it matches several, they fail at once with a strict mode violation instead of waiting; narrow the locator down.

## Text and URLs

- `toHaveText` with a string compares the whole text, after collapsing runs of whitespace and trimming. `"Note saved"` doesn't match `"Your note was saved"`. Use a regular expression to match part of the text: `toHaveText(/saved/)`.
- `toHaveURL` with a string compares the full URL. A relative string such as `"/notes"` is resolved against `baseURL` first. A regular expression is tested against the full URL.

## Coming from Playwright

Intelliwright has fewer built-in page matchers than Playwright. These cover the common cases:

| Playwright | Intelliwright |
| --- | --- |
| `toBeHidden()` | `not.toBeVisible()` |
| `toContainText("saved")` | `toHaveText(/saved/)` |
| `toHaveText("Saved")` | `toHaveText("Saved")` |
| `toHaveCount(3)` | `toHaveCount(3)` |
| `toHaveURL(/notes/)` | `toHaveURL(/notes/)` |

For anything else, such as an attribute or a checked state, first wait for the page with a page matcher, then read the value and check it with a Jest matcher:

```ts
await expect(saveButton).toBeVisible();
expect(await saveButton.getAttribute("aria-pressed")).toBe("true");
```

Playwright's own waiting methods also work, such as `locator.waitFor({ state: "detached" })` and `page.waitForURL("**/notes")`.

## In the report

Each page and AI assertion is a step in the report, with the line of the test it came from. A failing assertion shows what it expected, what it found, and how long it waited:

```text
expect(locator).toHaveText(expected)

Locator: getByRole('alert')
Expected string: "Note saved"
Received: "Couldn't save the note"

Timed out after 5000ms.
```
