import type { MatcherContext } from "expect";
import type { Locator, Page } from "playwright-core";
import { stripAnsi } from "../reporters/format.js";
import { userFrame } from "../runner/location.js";
import { shared } from "../runner/state.js";

export interface TimeoutOptions {
  /** Milliseconds to keep retrying. Defaults to the config's `expect.timeout`. */
  timeout?: number;
}

export interface TextOptions extends TimeoutOptions {
  ignoreCase?: boolean;
  /** Compare `innerText` instead of `textContent`. */
  useInnerText?: boolean;
}

export interface ViewportOptions extends TimeoutOptions {
  /** Share of the element that must be in the viewport, from 0 to 1. 0 means any part. */
  ratio?: number;
}

type MatcherResult = { pass: boolean; message(): string };

interface Probe<T> {
  pass: boolean;
  value: T;
  /** Stop retrying, for example on a strict mode violation. */
  final?: boolean;
}

export function isLocator(value: unknown): value is Locator {
  const candidate = value as Partial<Locator> | null;
  return typeof candidate?.count === "function" && typeof candidate.first === "function" && typeof candidate.page === "function";
}

export function isPage(value: unknown): value is Page {
  const candidate = value as Partial<Page> | null;
  return typeof candidate?.goto === "function" && typeof candidate.url === "function" && typeof candidate.title === "function";
}

export function expectTimeout(options?: TimeoutOptions): number {
  return options?.timeout ?? shared().running?.config.expectTimeout ?? 5_000;
}

/** Retries `probe` until the expectation, or its `.not`, holds or time runs out. */
export async function poll<T>(timeout: number, isNot: boolean, probe: () => Promise<Probe<T>>): Promise<Probe<T> & { timedOut: boolean }> {
  const deadline = Date.now() + timeout;
  const signal = shared().running?.info.signal;
  const intervals = [100, 250, 500, 1_000];
  for (let attempt = 0; ; attempt++) {
    const result = await probe();
    if (result.pass !== isNot || result.final) return { ...result, timedOut: false };
    const remaining = deadline - Date.now();
    if (remaining <= 0 || signal?.aborted) return { ...result, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervals[attempt] ?? 1_000, remaining)));
  }
}

/** Runs a matcher and records it as an `expect` step of the running test. */
export async function asStep(context: MatcherContext, title: string, run: () => Promise<MatcherResult>): Promise<MatcherResult> {
  const running = shared().running;
  const startTime = Date.now();
  const location = running ? userFrame(new Error().stack, running.config.rootDir) : undefined;
  const result = await run();
  const failed = result.pass === Boolean(context.isNot);
  running?.recordStep({
    title: `expect${context.isNot ? ".not" : ""}.${title}`,
    category: "expect",
    startTime,
    duration: Date.now() - startTime,
    location,
    error: failed ? { message: stripAnsi(result.message()) } : undefined,
  });
  return result;
}

function requireLocator(context: MatcherContext, matcher: string, received: unknown): Locator {
  if (isLocator(received)) return received;
  throw new Error(
    `${context.utils.matcherHint(matcher, undefined, undefined, { isNot: context.isNot })}\n\n` +
      `${matcher}() needs a Locator, such as page.getByRole("button", { name: "Save" }). Received: ${context.utils.printReceived(received)}`,
  );
}

function requirePage(context: MatcherContext, matcher: string, received: unknown): Page {
  if (isPage(received)) return received;
  throw new Error(
    `${context.utils.matcherHint(matcher, undefined, undefined, { isNot: context.isNot })}\n\n` +
      `${matcher}() needs a Page. Received: ${context.utils.printReceived(received)}`,
  );
}

const NO_ARGUMENT = new Set(["toBeVisible", "toBeInViewport"]);

function report(
  context: MatcherContext,
  matcher: string,
  subject: string,
  lines: string[],
  timedOut: boolean,
  timeout: number,
): string {
  const hint = context.utils.matcherHint(matcher, subject === "page" ? "page" : "locator", NO_ARGUMENT.has(matcher) ? "" : "expected", {
    isNot: context.isNot,
    promise: context.promise,
  });
  const where = subject === "page" ? "" : `Locator: ${subject}\n`;
  return `${hint}\n\n${where}${lines.join("\n")}${timedOut ? `\n\nTimed out after ${timeout}ms.` : ""}`;
}

function normalize(text: string, ignoreCase = false): string {
  const collapsed = text.replace(/[\s\u200b]+/g, " ").trim();
  return ignoreCase ? collapsed.toLowerCase() : collapsed;
}

function matchText(actual: string, expected: string | RegExp, ignoreCase?: boolean): boolean {
  if (typeof expected === "string") return normalize(actual, ignoreCase) === normalize(expected, ignoreCase);
  const pattern = ignoreCase && !expected.flags.includes("i") ? new RegExp(expected.source, `${expected.flags}i`) : expected;
  pattern.lastIndex = 0;
  return pattern.test(actual);
}

function strictViolation(count: number): string {
  return `strict mode violation: the locator matches ${count} elements`;
}

async function toBeVisible(this: MatcherContext, received: unknown, options?: TimeoutOptions): Promise<MatcherResult> {
  const locator = requireLocator(this, "toBeVisible", received);
  const timeout = expectTimeout(options);
  return asStep(this, "toBeVisible()", async () => {
    const result = await poll(timeout, Boolean(this.isNot), async () => {
      const count = await locator.count();
      if (count > 1) return { pass: false, value: strictViolation(count), final: true };
      if (count === 0) return { pass: false, value: "not found" };
      const visible = await locator.isVisible();
      return { pass: visible, value: visible ? "visible" : "hidden" };
    });
    return {
      pass: result.pass,
      message: () =>
        report(this, "toBeVisible", String(locator), [`Expected: ${this.isNot ? "not " : ""}visible`, `Received: ${result.value}`], result.timedOut, timeout),
    };
  });
}

async function toBeInViewport(this: MatcherContext, received: unknown, options?: ViewportOptions): Promise<MatcherResult> {
  const locator = requireLocator(this, "toBeInViewport", received);
  const timeout = expectTimeout(options);
  const minimum = options?.ratio ?? 0;
  return asStep(this, "toBeInViewport()", async () => {
    const result = await poll(timeout, Boolean(this.isNot), async () => {
      const count = await locator.count();
      if (count > 1) return { pass: false, value: strictViolation(count), final: true };
      if (count === 0) return { pass: false, value: "not found" };
      const ratio = await locator
        .evaluate(
          (element) =>
            new Promise<number>((resolve) => {
              const observer = new IntersectionObserver((entries) => {
                observer.disconnect();
                resolve(entries[0]?.intersectionRatio ?? 0);
              });
              observer.observe(element);
            }),
          undefined,
          { timeout: 2_000 },
        )
        .catch(() => 0);
      const pass = minimum > 0 ? ratio >= minimum : ratio > 0;
      return { pass, value: `${Math.round(ratio * 100)}% of the element is in the viewport` };
    });
    const expected = minimum > 0 ? `at least ${Math.round(minimum * 100)}% in the viewport` : "in the viewport";
    return {
      pass: result.pass,
      message: () =>
        report(this, "toBeInViewport", String(locator), [`Expected: ${this.isNot ? "not " : ""}${expected}`, `Received: ${result.value}`], result.timedOut, timeout),
    };
  });
}

async function toHaveText(
  this: MatcherContext,
  received: unknown,
  expected: string | RegExp | Array<string | RegExp>,
  options?: TextOptions,
): Promise<MatcherResult> {
  const locator = requireLocator(this, "toHaveText", received);
  const timeout = expectTimeout(options);
  return asStep(this, "toHaveText()", async () => {
    const result = await poll<string | string[]>(timeout, Boolean(this.isNot), async () => {
      const texts = options?.useInnerText ? await locator.allInnerTexts() : await locator.allTextContents();
      if (Array.isArray(expected)) {
        const pass = texts.length === expected.length && texts.every((text, i) => matchText(text, expected[i]!, options?.ignoreCase));
        return { pass, value: texts.map((text) => normalize(text)) };
      }
      if (texts.length > 1) return { pass: false, value: strictViolation(texts.length), final: true };
      if (texts.length === 0) return { pass: false, value: "element not found" };
      return { pass: matchText(texts[0]!, expected, options?.ignoreCase), value: normalize(texts[0]!) };
    });
    const kind = expected instanceof RegExp ? "pattern" : Array.isArray(expected) ? "array" : "string";
    return {
      pass: result.pass,
      message: () =>
        report(
          this,
          "toHaveText",
          String(locator),
          [
            `Expected ${kind}: ${this.isNot ? "not " : ""}${this.utils.printExpected(expected)}`,
            `Received: ${typeof result.value === "string" && result.value.startsWith("strict mode") ? result.value : this.utils.printReceived(result.value)}`,
          ],
          result.timedOut,
          timeout,
        ),
    };
  });
}

async function toHaveCount(this: MatcherContext, received: unknown, expected: number, options?: TimeoutOptions): Promise<MatcherResult> {
  const locator = requireLocator(this, "toHaveCount", received);
  const timeout = expectTimeout(options);
  return asStep(this, "toHaveCount()", async () => {
    const result = await poll(timeout, Boolean(this.isNot), async () => {
      const count = await locator.count();
      return { pass: count === expected, value: count };
    });
    return {
      pass: result.pass,
      message: () =>
        report(
          this,
          "toHaveCount",
          String(locator),
          [`Expected: ${this.isNot ? "not " : ""}${this.utils.printExpected(expected)}`, `Received: ${this.utils.printReceived(result.value)}`],
          result.timedOut,
          timeout,
        ),
    };
  });
}

async function toHaveURL(this: MatcherContext, received: unknown, expected: string | RegExp, options?: TimeoutOptions): Promise<MatcherResult> {
  const page = requirePage(this, "toHaveURL", received);
  const timeout = expectTimeout(options);
  const baseURL = shared().running?.config.baseURL;
  const target = typeof expected === "string" && baseURL ? new URL(expected, baseURL).href : expected;
  return asStep(this, "toHaveURL()", async () => {
    const result = await poll(timeout, Boolean(this.isNot), async () => {
      const url = page.url();
      return { pass: typeof target === "string" ? url === target : (target.lastIndex = 0, target.test(url)), value: url };
    });
    return {
      pass: result.pass,
      message: () =>
        report(
          this,
          "toHaveURL",
          "page",
          [`Expected: ${this.isNot ? "not " : ""}${this.utils.printExpected(target)}`, `Received: ${this.utils.printReceived(result.value)}`],
          result.timedOut,
          timeout,
        ),
    };
  });
}

async function toHaveTitle(this: MatcherContext, received: unknown, expected: string | RegExp, options?: TimeoutOptions): Promise<MatcherResult> {
  const page = requirePage(this, "toHaveTitle", received);
  const timeout = expectTimeout(options);
  return asStep(this, "toHaveTitle()", async () => {
    const result = await poll(timeout, Boolean(this.isNot), async () => {
      const title = await page.title();
      return { pass: matchText(title, expected), value: normalize(title) };
    });
    return {
      pass: result.pass,
      message: () =>
        report(
          this,
          "toHaveTitle",
          "page",
          [`Expected: ${this.isNot ? "not " : ""}${this.utils.printExpected(expected)}`, `Received: ${this.utils.printReceived(result.value)}`],
          result.timedOut,
          timeout,
        ),
    };
  });
}

export const webMatchers: Record<string, (this: MatcherContext, received: unknown, ...args: any[]) => Promise<MatcherResult>> = {
  toBeVisible,
  toBeInViewport,
  toHaveText,
  toHaveCount,
  toHaveURL,
  toHaveTitle,
};
