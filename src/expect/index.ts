import { expect as jestExpect, type Expect } from "expect";
import { webMatchers, type TextOptions, type TimeoutOptions, type ViewportOptions } from "./web-matchers.js";

jestExpect.extend(webMatchers);

/** Jest's `expect`, plus page matchers that retry until they pass. Await page matchers. */
export const expect: Expect = jestExpect;

export type { TextOptions, TimeoutOptions, ViewportOptions };

declare module "expect" {
  interface Matchers<R extends void | Promise<void>, T = unknown> {
    /** The locator matches one element, and it is visible. Retries until the timeout. */
    toBeVisible(options?: TimeoutOptions): Promise<void>;
    /** The locator's element intersects the viewport. Retries until the timeout. */
    toBeInViewport(options?: ViewportOptions): Promise<void>;
    /** Text of the element, or of each element for an array. Whitespace is normalized. */
    toHaveText(expected: string | RegExp | Array<string | RegExp>, options?: TextOptions): Promise<void>;
    /** Number of elements the locator matches. */
    toHaveCount(expected: number, options?: TimeoutOptions): Promise<void>;
    /** The page URL. Relative URLs resolve against `baseURL`. */
    toHaveURL(expected: string | RegExp, options?: TimeoutOptions): Promise<void>;
    toHaveTitle(expected: string | RegExp, options?: TimeoutOptions): Promise<void>;
  }
}
