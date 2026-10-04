---
title: Goal-driven runs
description: Reach a plain-English goal one click or fill at a time with ai.run, then turn the run into fixed Playwright code.
---

`ai.run(goal, options)` works towards a goal one click or fill at a time, and throws if it can't reach it. It's the quickest way to get a new flow working, and it hands back the same flow as fixed Playwright code, so you can replace it with a deterministic test once it works.

```ts title="e2e/notes.e2e.ts"
import { expect, test } from "./fixtures";

test("saves a note", async ({ page, ai }) => {
  const title = `Groceries ${Date.now()}`;
  await page.goto("/notes/new");

  const result = await ai.run("save a new note with the given title and body", {
    data: { title, body: "Milk, eggs and bread." },
    avoid: ["the Delete button", "the Sign out link"],
    maxSteps: 6,
  });

  expect(result.steps.map((step) => step.action)).toEqual(["fill", "fill", "click"]);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});
```

`result.code` holds the same flow as Playwright code, with text read from `data`:

```ts
await page.getByLabel('Title', { exact: true }).fill(data.title);
await page.getByLabel('Body', { exact: true }).fill(data.body);
await page.getByRole('button', { name: 'Save note', exact: true }).click();
```

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `data` | `{}` | Values for text fields, by key. Jev picks which key goes into which field; it never writes text. |
| `avoid` | `[]` | Elements the run must never use, in plain English, such as `"the Delete account button"`. |
| `maxSteps` | 10 | The most clicks and fills before giving up. |
| `minProbability` | `ai.minProbability`, 0.7 | How sure Jev must be of each step. |

## What each step does

1. **One request about the page.** Intelliwright captures the page and asks Jev, in one request:
   - whether the page shows the goal is done, given what the run has done so far;
   - which element to use next, or that nothing on the page moves towards the goal;
   - whether an error message or a blocking dialog is showing;
   - whether the page is still loading;
   - which element each `avoid` description means.
2. **Done?** If the goal looks reached, the run ends. That's when its probability reaches `minProbability`, or when it's at least 0.5, no error is showing, and nothing on the page is left to do.
3. **Still loading?** If the page looks like it's loading, the run waits and looks again, up to 5 times, without using a step.
4. **The next element.** Otherwise, the run uses the most likely element that isn't one to avoid. If Jev's pick is below `minProbability`, the run stops.
5. **Click or fill.** A button or link is clicked. For a text field, a second request asks which `data` key belongs in it. That question names each key and the kind of value it holds, such as "an email address" or "text, 3 words", never the value itself.
6. **Wait.** After the action, the run waits for the page to load and for the network to be quiet for half a second, up to 5 seconds, so a form post can finish.

Jev also reads what the run has done so far, such as `fill textbox "Title" with "Groceries 1759555200000"`, so it can recognize the result on the page. Values typed into password fields are never quoted there, and `ai.redact` patterns apply.

Each step costs one request, or two for a text field.

## Writing goals

- Describe the end state: "save a new note with the given title and body", not "click Save".
- Mention the data when the run has to type it, as in "with the given title and body".
- Start the run on the page where the flow begins, with `page.goto()` or a page object's `goto()`.
- Use `avoid` for anything destructive or off-path that sits near the flow, such as Delete or Sign out.

## Staying on your site

The run stays on the origin of `baseURL`, or of the current page when there's no `baseURL`. Links to other origins aren't offered to Jev, and navigations to other origins are blocked and listed in `result.blockedNavigations`.

## When a run stops

| `reason` | Why |
| --- | --- |
| `goal-met` | The page shows the goal is done. `ai.run` returns the result. |
| `stuck` | Nothing on the page moves towards the goal, Jev wasn't sure enough of the next step, or it chose an element that changed nothing the last time. |
| `max-steps` | The run used `maxSteps` actions without reaching the goal. |
| `missing-data` | A text field needs a value, but `data` is empty or none of its keys clearly fits. |

For every reason except `goal-met`, `ai.run` throws. The error lists the steps it took and the odds Jev gave:

```text
ai.run("save a new note with the given title and body") stopped without reaching the goal (stuck after 2 steps).
Jev wasn't sure what to do next: button "Save draft" in main (0.55, needs 0.70; goal reached 0.12, error or dialog showing 0.03, loading 0.02).
Steps:
  1. fill textbox "Title" (empty) in main
  2. fill textbox "Body" (empty) in main
```

The report then also has an attachment, `ai.run: the page Jev saw last`, with the page state Jev answered from. Look there first: the failure screenshot is taken after `afterEach` hooks and fixtures have run, so it can show a page that changed since.

## Turning a run into code

`ai.run` is for exploring. Once a run works:

1. Copy `result.code`, which is also attached to the report as `ai.run: <goal>`.
2. Paste it into a page object method, replacing `data.title` and the like with parameters.
3. Call that method from the test instead of `ai.run`.

```ts title="e2e/pages/new-note.page.ts"
import { BasePage } from "intelliwright";

export class NewNotePage extends BasePage {
  readonly path = "/notes/new";

  async save(note: { title: string; body: string }) {
    await this.page.getByLabel("Title", { exact: true }).fill(note.title);
    await this.page.getByLabel("Body", { exact: true }).fill(note.body);
    await this.page.getByRole("button", { name: "Save note", exact: true }).click();
  }
}
```

The test is now deterministic, faster, and makes no Jev calls.

## The result

| Field | What it holds |
| --- | --- |
| `goal` | The goal you passed. |
| `goalMet` | `true` when `ai.run` returns. |
| `reason` | Why the run stopped. |
| `steps` | Each step: `index`, `action` (`click` or `fill`), the `element` as Jev saw it, the step as `code`, the `dataKey` it filled, the `probability` of the pick, and the page `url`. |
| `code` | All steps as Playwright code. |
| `detail` | Why the run stopped, when it didn't reach the goal. |
| `blockedNavigations` | Navigations to other origins that the run blocked. |

The error thrown when the goal isn't reached is named `GoalNotReachedError` and carries the same object as `error.result`.
