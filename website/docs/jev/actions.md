---
title: AI actions
description: Click, fill, select, check, hover and locate elements by describing them, with results cached as readable locators.
---

AI actions find an element from a plain-English description and act on it. They're for elements that are hard to target with a fixed locator, such as an icon button without a name. The result is cached as an ordinary Playwright locator, so later runs don't call Jev until the page changes.

```ts
await ai.click("the Sign in button in the header");
await ai.fill("the search field", "groceries");
await ai.select("the sort order menu", "newest");
await ai.check("the terms checkbox");
await ai.check("the newsletter switch", { checked: false });
await ai.hover("the user menu");

const card = await ai.locate("the first note in the list");
await expect(card).toHaveText(/Groceries/);
```

`ai` is a [fixture](../writing-tests/fixtures.md) in tests, and `this.ai` in [page objects](../writing-tests/page-objects.md#using-jev-inside-a-page-object).

Prefer fixed locators. When a fixed locator is possible, use it in the page object, or add a test id to the app. Keep AI actions for the few elements where that isn't practical.

## The actions

| Action | What it does |
| --- | --- |
| `ai.click(description, options?)` | Clicks the element. |
| `ai.fill(description, value, options?)` | Types `value` into the text field. |
| `ai.select(description, value, options?)` | Picks an option, or several with an array, in the select box. |
| `ai.check(description, options?)` | Checks the checkbox, radio button or switch, or unchecks it with `{ checked: false }`. |
| `ai.hover(description, options?)` | Hovers the element. |
| `ai.locate(description, options?)` | Returns a Playwright `Locator` for the element, to use with any Playwright method or assertion. |

| Option | Default | What it does |
| --- | --- | --- |
| `minProbability` | `ai.minProbability`, 0.7 | How sure Jev must be of its pick. |
| `timeout` | No limit | Milliseconds for the Playwright action itself. |
| `checked` | `true` | For `ai.check` only: `false` unchecks. |

## How an action finds its element

1. **The cache.** If the cache has a locator for this page path, action and description, and it matches exactly one element within 2 seconds, the action uses it with no Jev call.
2. **Candidates.** Otherwise, Intelliwright lists the visible, enabled elements that suit the action:
   - `click` and `hover`: buttons, links, tabs, menu items, options, form controls, and anything with a pointer cursor;
   - `fill`: text boxes, search boxes, number fields, and combo boxes you type into;
   - `select`: select boxes and list boxes;
   - `check`: checkboxes, radio buttons and switches;
   - `locate`: everything above, plus any other element with a name or text.
3. **Jev's choice.** The candidates are ranked by how many words they share with the description, and up to 254 of them, plus a "none of these" option, go to Jev as one choice question along with the page state.
4. **A threshold.** If Jev picks "none", or its pick is below `minProbability`, the action throws with the three best matches.
5. **A readable locator.** The pick becomes the most readable locator that matches only that element: a test id, then role and name, then role and name inside a landmark, then label, placeholder or text, and finally role and name with an index. That locator is cached.
6. **The action.** The Playwright action runs on that locator, such as `click()`, `fill()`, `selectOption()`, `setChecked()` or `hover()`.

The value you pass to `ai.fill` isn't part of the question: Jev only chooses the field. The step in the report shows the action and description, and a note with the locator it used:

```text
ai.click("the Sign in button in the header")
  chose: page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true })
```

When Jev isn't sure, the error lists the best matches:

```text
ai.click("the Delete button") isn't sure which element to use (0.52, needs 0.70).
Best matches:
  0.52  button "Delete note" in main
  0.31  button "Delete account" in navigation "Settings"
  0.09  link "Deleted notes" in navigation "Main"
Describe the element more precisely, or use a fixed locator in the page object.
```

## Writing descriptions

Describe the element the way a person would: its text, its role, and where it is. "The Delete button next to the Groceries note" is better than "delete". Jev reads each candidate as its role, its name and its surroundings, such as `button "Delete note" in main`, so words that appear in those help.

The cache is keyed by the exact description, so keep descriptions stable. Changing one makes the next run ask Jev again.

## The locator cache

Resolved locators are saved in `.intelliwright/cache.json`, keyed by the page's URL path, the action and the description:

```json title=".intelliwright/cache.json"
{
  "version": 1,
  "entries": {
    "/notes click the Sign in button in the header": {
      "locator": { "kind": "role", "role": "button", "name": "Sign in", "within": { "role": "banner" } },
      "element": "button \"Sign in\" in banner",
      "updated": "2026-10-04T05:12:44.512Z"
    }
  }
}
```

- **Commit the cache.** CI then makes no Jev calls for actions whose locators still match. Changes to the cache in a pull request should match changes to the pages.
- **A stale entry fixes itself.** When the cached locator no longer matches exactly one element, the action asks Jev again and updates the entry.
- **`--update-cache`** resolves every action again, ignoring the cache, and saves the new results.
- **`ai: { cache: false }`** turns the cache off.

Workers running in parallel merge their changes into the file, so it stays consistent.

## Turning an action into a fixed locator

The note in the report and the `locator` in the cache are ordinary Playwright locators. Once an AI action has found an element you use often, copy its locator into the page object as a field and drop the AI action. The test then needs no Jev call at all.
