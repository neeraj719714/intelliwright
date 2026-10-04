import { expect as jestExpect, type Expect } from "expect";
import { aiMatchers, type AiMatcherOptions, type ScoreMatcherOptions } from "./ai-matchers.js";
import { webMatchers, type TextOptions, type TimeoutOptions, type ViewportOptions } from "./web-matchers.js";

jestExpect.extend({ ...webMatchers, ...aiMatchers });

/** Jest's `expect`, plus page matchers that retry and Jev-powered checks. Await both. */
export const expect: Expect = jestExpect;

export type { AiMatcherOptions, ScoreMatcherOptions, TextOptions, TimeoutOptions, ViewportOptions };

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
    /**
     * Jev checks a plain-English claim about the page or element. Passes when
     * the probability is at least `minProbability`; with `.not`, at most
     * `1 - minProbability`. Asks again only when the page changes.
     */
    toSatisfy(claim: string, options?: AiMatcherOptions): Promise<void>;
    /** Checks several claims about the same page in one request. All must hold. */
    toSatisfyAll(claims: string[], options?: AiMatcherOptions): Promise<void>;
    /** Jev rates the page on ordered levels, lowest first, such as ["Unclear", "Clear"]. */
    toScore(question: string, levels: string[], options: ScoreMatcherOptions): Promise<void>;
  }
}
