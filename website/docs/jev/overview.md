---
title: How Jev features work
sidebar_label: How Jev features work
description: What Jev is, what it sees of a page, how probabilities and thresholds work, what requests cost, and how private data is kept out.
---

Jev is a decision model from TypeSafe AI. It answers typed questions about a state, and every answer is a probability. Intelliwright uses it for four things:

| Feature | What it asks |
| --- | --- |
| [AI assertions](assertions.md) | Is this claim about the page true? How does the page rate on these levels? |
| [AI actions](actions.md) and [goal-driven runs](goals.md) | Which of these elements fits the description, or moves towards the goal? |
| [Questions](questions.md) | Your own yes/no, choice and score questions. |
| [Failure triage](triage.md) | What most likely caused this failure, and how severe is it? |

Jev doesn't write text or code. It picks among options that Intelliwright gives it, and anything a test types comes from the test.

## What Jev sees

Jev reads text, never images. For each question, Intelliwright captures the page as a small JSON object:

| Field | What it holds |
| --- | --- |
| `url` | The page URL. |
| `title` | The page title. |
| `aria` | Playwright's ARIA snapshot of the page, as YAML text. |
| `element` | When the question is about one element, which locator it was. |
| `note` | When parts of the page were left out to fit the request, a note saying so. |

The ARIA snapshot is an outline of what assistive technology sees: roles, accessible names, text, and states such as checked or disabled. For a small notes page it looks like this:

```yaml
- banner:
  - link "Notes":
    - /url: /
  - button "Account menu"
- main:
  - heading "Groceries" [level=1]
  - paragraph: Milk, eggs and bread.
  - button "Delete note"
```

Each provider limits how many tokens a request may use. When a page is too large, Intelliwright leaves out elements far outside the viewport first, then deeply nested ones, and adds a `note`. Screenshots are still saved when a test fails, but only for people to look at.

Because Jev reads the ARIA snapshot, pages with good accessibility, such as labeled fields and named buttons, also get better answers.

## Probabilities and thresholds

Every answer is a probability from 0 to 1, not a verdict. A check passes, and an action goes ahead, when the probability reaches a threshold: `ai.minProbability` in the config, 0.7 by default. Each assertion and action also takes its own `minProbability`.

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: { minProbability: 0.8 },
});
```

Answers vary slightly between identical requests, so never expect exact values. Keep the default threshold unless labeled examples show that another value works better. If you tune thresholds, pin the model version too; see [Providers](providers.md#settings).

Every decision is listed in the HTML report with its question, answer and probability, and its confidence when the provider returns one.

## Requests and cost

- **One page state per request.** Questions about the same state that start together, such as several assertions in a `Promise.all`, go out as one request. `toSatisfyAll` checks a list of claims in one request.
- **Large requests are split** when they would go over the provider's token limit, sent in parallel, and their answers merged.
- **Concurrency is capped** at 4 requests in flight per worker by default (`ai.maxConcurrency`).
- **Transient failures are retried**: timeouts, network errors, 408, 429 and 5xx responses, with backoff that honors `retry-after`. Each attempt times out after 30 seconds, and there are 3 retries by default.
- **Cached actions are free.** An [AI action](actions.md) whose cached locator still matches makes no request at all.

At the end of a run, the terminal shows the provider, the model versions that answered, the number of calls, the input tokens and the cost:

```text
  Jev  TypeSafe (jev-1.13.0): 6 calls, 14,380 input tokens, $0.000604
```

The cost comes from the provider when it reports one, and is otherwise estimated from the tokens, marked `(estimated)`.

## Privacy

- **Password fields are always masked.** Their values are replaced with `[redacted]` before any page state leaves your machine.
- **`ai.redact` masks anything else.** Regular expressions mask matching text. Strings are selectors, as in `page.locator()`, whose elements' text and values are masked wherever they appear.

  ```ts title="intelliwright.config.ts"
  export default defineConfig({
    ai: {
      redact: [/\b\d{4}(?: \d{4}){3}\b/, "[data-private]", ".account-email"],
    },
  });
  ```

- **Keys stay out of output.** API keys are never written to reports, traces, the cache or logs, and error messages strip them.
- **Sign-ins aren't traced**, so a typed password never lands in a trace file.
- **Triage sends more than the page.** It also sends the error message, the last steps, console errors and failed request URLs. See [Failure triage](triage.md#what-jev-is-given).

## Without a key

Jev features are optional. Without a provider:

- tests that don't use them run as usual;
- an AI assertion or action fails with a message that says how to set a key;
- failure triage is skipped, with a note in the summary.

To run tests that use Jev features without a key, for example in a fork's CI, pass a [mock evaluator](providers.md#a-mock-for-offline-runs) as the provider.

## Errors

Problems talking to a provider throw a `JevError`. Its `kind` says what went wrong:

| `kind` | Meaning |
| --- | --- |
| `config` | No provider, an unknown preset, or a missing key. |
| `auth` | The provider rejected the key (401). |
| `payment` | The provider wants payment (402), for example when credits run out. |
| `forbidden` | The provider refused the request (403). |
| `invalid_request` | The provider rejected the request, or it is too large for one request. |
| `rate_limited` | Still rate-limited (429) after every retry. |
| `server` | Still failing with 5xx after every retry. |
| `network` | The provider couldn't be reached after every retry. |
| `timeout` | Every attempt timed out. |
| `invalid_answer` | The answer didn't fit the question, such as a choice that wasn't offered. |

`isJevError(error)` tells a `JevError` apart from other errors, even across two copies of the package.
