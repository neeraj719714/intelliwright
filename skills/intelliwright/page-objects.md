# Page objects

One class per page or large component, in `e2e/pages/`, extending `BasePage`.
`BasePage` gives every page object `this.page`, `this.ai`, and `goto()`, which
opens `path` relative to `baseURL` and then calls `waitUntilReady()`.

## Naming

- File: `e2e/pages/<kebab-name>.page.ts`, such as `note-list.page.ts`.
- Class: `<PascalName>Page` for pages, `<PascalName>` for components, such as
  `NoteListPage` and `FeedbackDialog`.
- Fixture name: the class name in camelCase, such as `noteListPage`.
- Locator fields: what the element is, such as `searchField`, `saveButton`,
  `rows`. Not `button1` or `div`.
- Methods: what the user is trying to do, such as `search(text)`,
  `openNote(title)`, `submitFeedback(message)`.

## Page template

```ts
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

`waitUntilReady()` is the only place a page object asserts. Everything else
returns locators or performs actions, and tests make the assertions.

## Component template

Components that appear on several pages, such as a dialog or a header, get
their own class. Pass the page in and scope every locator to the component:

```ts
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

A component has no `path`; calling its `goto()` throws.

## Using Jev inside a page object

For an element that is hard to target with a fixed locator, use `this.ai`:

```ts
async openUserMenu() {
  await this.ai.click("the avatar button that opens the user menu");
}
```

Keep these rare. When a fixed locator is possible, add a test id to the app
instead.

## Registering page objects

```ts
// e2e/fixtures.ts
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

A fixture is set up only for tests that ask for it by name. Fixtures must
destructure what they use, as in `async ({ page, ai }, provide) => ...`, and
call the callback `provide`, never `use`.
