import type { Page } from "playwright-core";
import type { Ai } from "../ai/fixture.js";

type GotoOptions = NonNullable<Parameters<Page["goto"]>[1]>;

/**
 * The base for page objects: one class per page or large component, with
 * locators as readonly fields and methods named after what the user does.
 *
 * ```ts
 * export class NewProblemPage extends BasePage {
 *   readonly path = "/problems/new";
 *   readonly titleField = this.page.getByLabel("Title");
 * }
 * ```
 */
export abstract class BasePage {
  readonly page: Page;
  /** Jev-powered actions and questions, for elements that are hard to target with a fixed locator. */
  readonly ai: Ai;
  /** Where `goto()` goes, relative to `baseURL`. */
  declare readonly path?: string;

  constructor(page: Page, ai: Ai) {
    this.page = page;
    this.ai = ai;
  }

  /** Opens `path`, then waits until the page is ready. */
  async goto(options?: GotoOptions): Promise<void> {
    if (this.path === undefined) {
      throw new Error(`${this.constructor.name} has no path. Set readonly path = "/..." to use goto().`);
    }
    await this.page.goto(this.path, options);
    await this.waitUntilReady();
  }

  /** Override to wait for the page's content, for example `await expect(this.heading).toBeVisible()`. */
  async waitUntilReady(): Promise<void> {}
}
