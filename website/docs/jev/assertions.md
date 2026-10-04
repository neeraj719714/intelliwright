---
title: AI assertions
description: Check plain-English claims about a page or element with toSatisfy, toSatisfyAll and toScore.
---

AI assertions check things that are about meaning rather than exact text: that a message explains an error, that the new item is shown, that a page looks finished. They work on a page or on a locator, and like the [page matchers](../writing-tests/assertions.md), they must be awaited.

```ts
await expect(page).toSatisfy("the new note is shown with its title");
await expect(page.getByRole("alert")).toSatisfy("the message says the card was declined");
await expect(page).not.toSatisfy("an error message is shown");
```

Prefer a fixed assertion such as `toHaveText` when you know the exact text. Reach for an AI assertion when the wording can change but the meaning shouldn't.

## toSatisfy

`toSatisfy(claim, options?)` asks Jev for the probability that the claim is true. It passes at `minProbability` or above, 0.7 by default. With `.not`, it passes when the probability is at most `1 - minProbability`, 0.3 by default.

When it fails, the message shows the probability and what was needed:

```text
expect(page).toSatisfy(claim)

Claim: the new note is shown with its title
Probability: 0.42, needed at least 0.70
Page: http://localhost:3000/notes "Notes"
Model: jev-1.13.0, 2 calls
```

## toSatisfyAll

`toSatisfyAll(claims, options?)` checks several claims about the same page in one request. Every claim must pass. With `.not`, none may hold.

```ts
await expect(page).toSatisfyAll([
  "the cart shows 3 items",
  "the total is shown in dollars",
  "a Checkout button is visible",
]);
```

The failure message lists every claim:

```text
expect(page).toSatisfyAll(claims)

Each claim needs a probability at least 0.70:
  ✓ 0.96  the cart shows 3 items
  ✗ 0.31  the total is shown in dollars
  ✓ 0.92  a Checkout button is visible

Page: http://localhost:3000/cart "Cart"
Model: jev-1.13.0, 1 call
```

## toScore

`toScore(question, levels, options)` asks Jev to rate the page on ordered levels, lowest first. It needs `atLeast`, `atMost`, or both.

```ts
await expect(page.getByRole("alert")).toScore(
  "How clearly does the message explain what went wrong?",
  ["Not at all", "Vaguely", "Clearly", "Very clearly"],
  { atLeast: 2 },
);
```

- Levels are numbered from 0, so `atLeast: 2` means "Clearly" or better.
- There must be from 2 to 10 levels.
- The score is the probability-weighted level, so it can land between levels, such as 2.4. `atLeast` and `atMost` include their bounds.

## How an AI assertion waits

Pages change after they load, so an AI assertion keeps checking until the answer is what it wants or time runs out:

1. It captures the page, or the element, and asks Jev the claim together with "is the page still loading?" in one request.
2. If the answer passes, the assertion passes.
3. If the page looks like it's still loading, it keeps checking until the timeout. If it doesn't, it gives the page about a second to change, then fails.
4. It asks Jev again only when the page state has changed since the last request, and makes at most 8 requests.

The timeout is `expect.timeout` from the config, 5 seconds by default, or the `timeout` you pass.

## Options

| Option | Matchers | Default | What it does |
| --- | --- | --- | --- |
| `minProbability` | `toSatisfy`, `toSatisfyAll` | `ai.minProbability`, 0.7 | The probability a claim needs. |
| `atLeast` | `toScore` | | The lowest passing score. |
| `atMost` | `toScore` | | The highest passing score. |
| `timeout` | All three | `expect.timeout`, 5000 | Milliseconds to keep checking while the page changes. |

## Writing good claims

- **One checkable fact per claim.** Split "the cart has 3 items and a total" into two claims.
- **Group claims about the same page** into one `toSatisfyAll`: one request instead of several, and the failure lists every claim.
- **Scope to an element** by calling the matcher on a locator, so Jev reads only that part of the page.
- **Be concrete.** "The new note titled Groceries is at the top of the list" is easier to check than "the page looks right".
- **Watch for claims near the threshold.** A claim that passes at 0.72 and fails at 0.68 is too vague. Make it more specific, or check it with a fixed locator and `toHaveText`.

Each check is a step in the report, and the AI decisions table lists every claim with its probability and whether it passed.
