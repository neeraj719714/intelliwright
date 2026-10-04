---
title: Page objects
description: Write one class per page or component with BasePage, choose stable locators, and hand page objects to tests as fixtures.
---

A page object is a class for one page or large component. It holds the locators for the elements on that page, and methods named after what the user does there. Tests call those methods and make the assertions, so when the page changes, you fix one class instead of every test.

## BasePage

Every page object extends `BasePage`, which provides:

| Member | What it is |
| --- | --- |
| `page` | The test's Playwright `Page`. |
| `ai` | [Jev-powered actions](../jev/actions.md), for elements that are hard to target with a fixed locator. |
| `path` | Where `goto()` goes, relative to `baseURL`. Set it in the subclass. |
| `goto(options?)` | Opens `path`, then calls `waitUntilReady()`. Takes Playwright's `page.goto` options, such as `{ waitUntil: "networkidle" }`. |
| `waitUntilReady()` | Does nothing by default. Override it to wait for the page's content. |

## A page

```ts title="e2e/pages/note-list.page.ts"
import { BasePage, expect } from "intelliwright";

export class NoteListPage extends BasePage {
  readonly path = "/notes";
  readonly heading = this.page.getByRole("heading", { name: "Notes" });
  readonly searchField = this.page.getByRole("searchbox", { name: "Search notes" });
  readonly rows = this.page.getByRole("listitem");

  async waitUntilReady() {
    await expect(this.heading).toBeVisible();
  }

  async search(text: string) {
    await this.searchField.fill(text);
    await this.searchField.press("Enter");
  }

  note(title: string) {
    return this.rows.filter({ hasText: title });
  }
}
```

- Locators are `readonly` fields. Playwright locators are lazy, so creating them in field initializers is free: nothing is looked up until a test uses them.
- Methods are named after what the user is trying to do, such as `search(text)` and `openNote(title)`, not `clickButton()`.
- `waitUntilReady()` is the only place a page object asserts. Everything else returns locators or performs actions, and tests make the assertions.

In a JavaScript project, drop `readonly`: `path = "/notes";`.

## A component

Components that appear on several pages, such as a dialog or a header, get their own class. Scope every locator to the component:

```ts title="e2e/pages/feedback-dialog.ts"
import { BasePage } from "intelliwright";

export class FeedbackDialog extends BasePage {
  readonly dialog = this.page.getByRole("dialog", { name: "Send feedback" });
  readonly messageField = this.dialog.getByLabel("Message");
  readonly sendButton = this.dialog.getByRole("button", { name: "Send" });

  async submit(message: string) {
    await this.messageField.fill(message);
    await this.sendButton.click();
  }
}
```

A component has no `path`, so calling its `goto()` throws.

## Handing page objects to tests

Register each page object as a [fixture](fixtures.md) in `e2e/fixtures.ts`:

```ts title="e2e/fixtures.ts"
import { test as base } from "intelliwright";
import { FeedbackDialog } from "./pages/feedback-dialog";
import { NoteListPage } from "./pages/note-list.page";

export const test = base.extend<{ noteListPage: NoteListPage; feedbackDialog: FeedbackDialog }>({
  noteListPage: async ({ page, ai }, provide) => {
    await provide(new NoteListPage(page, ai));
  },
  feedbackDialog: async ({ page, ai }, provide) => {
    await provide(new FeedbackDialog(page, ai));
  },
});

export { expect } from "intelliwright";
```

```ts title="e2e/search.e2e.ts"
import { expect, test } from "./fixtures";

test("finds a note by title", { tag: "@search" }, async ({ noteListPage }) => {
  await noteListPage.goto();
  await noteListPage.search("Groceries");
  await expect(noteListPage.note("Groceries")).toBeVisible();
});
```

A fixture is set up only for tests that ask for it by name.

## Where files go

| What | Where | Name |
| --- | --- | --- |
| Page objects | `e2e/pages/` | `note-list.page.ts`, class `NoteListPage`, fixture `noteListPage` |
| Components | `e2e/pages/` | `feedback-dialog.ts`, class `FeedbackDialog`, fixture `feedbackDialog` |
| Fixtures | `e2e/fixtures.ts` | |
| Tests | `e2e/**/*.e2e.ts` | |
| Sign-ins | `e2e/auth.setup.ts` | |

Keep page objects in `e2e/pages/`, never in a `pages/` folder at the project root: frameworks such as Next.js and Nuxt treat that folder as routes.

## Choosing locators

Use the first of these that is unique and stable:

1. A test id: `page.getByTestId("save")`. The attribute is `data-testid` unless you set `testIdAttribute` in the config, for example to `data-test` or `data-cy`.
2. Role and accessible name: `page.getByRole("button", { name: "Save" })`.
3. Label: `page.getByLabel("Email")`.
4. Placeholder: `page.getByPlaceholder("Search")`.
5. Text: `page.getByText("No results")`.

Avoid CSS classes, generated ids, and XPath that depends on the layout. To narrow a locator down, chain it from a landmark: `page.getByRole("navigation").getByRole("link", { name: "Home" })`.

## Using Jev inside a page object

For an element that is hard to target with a fixed locator, use `this.ai`:

```ts
async openUserMenu() {
  await this.ai.click("the avatar button that opens the user menu");
}
```

Keep these rare. When a fixed locator is possible, prefer it, or add a test id to the app. The [locator cache](../jev/actions.md#the-locator-cache) keeps repeated runs from calling Jev again.

## Rules that keep tests readable

- Tests never use raw selectors. If a test needs an element, add it to the page object.
- Page objects contain no assertions, except in `waitUntilReady()`.
- One class per page or large component, named after it.
- Methods describe intent: `signIn(email, password)`, not `fillEmailAndClickButton()`.
