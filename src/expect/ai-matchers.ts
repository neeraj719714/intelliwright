import type { MatcherContext } from "expect";
import type { Locator, Page } from "playwright-core";
import type { PageState } from "../ai/page-state.js";
import { describeAnswer, LOADING, type AiRuntime } from "../ai/runtime.js";
import type { Answers, BooleanQuestion, EvaluateResult, Questions, ScoreQuestion } from "../ai/types.js";
import { shared } from "../runner/state.js";
import { asStep, expectTimeout, isLocator, isPage, type MatcherResult } from "./web-matchers.js";

export interface AiMatcherOptions {
  /** Probability a claim needs. Defaults to the config's `ai.minProbability`, 0.7. */
  minProbability?: number;
  /** Milliseconds to keep checking while the page changes. Defaults to `expect.timeout`. */
  timeout?: number;
}

export interface ScoreMatcherOptions {
  /** Lowest passing score, from 0 to the number of levels minus 1. */
  atLeast?: number;
  /** Highest passing score. */
  atMost?: number;
  timeout?: number;
}

/** After a failing answer on a page that isn't loading, wait this long for it to change. */
const SETTLE_MS = 1_000;
/** Most calls one matcher makes, even if the page keeps changing. */
const MAX_CALLS = 8;

type WithLoading<Qs extends Questions> = Qs & { loading: BooleanQuestion };

interface Settled<Qs extends Questions> {
  result: EvaluateResult<WithLoading<Qs>>;
  state: PageState;
  /** The value handed to Jest, which inverts it for `.not`. */
  pass: boolean;
  loading: boolean;
  timedOut: boolean;
  calls: number;
}

function runtime(matcher: string): AiRuntime {
  const ai = shared().running?.ai;
  if (!ai) throw new Error(`${matcher}() can only run inside a test.`);
  return ai;
}

function requireTarget(context: MatcherContext, matcher: string, received: unknown): Page | Locator {
  if (isPage(received) || isLocator(received)) return received;
  throw new Error(
    `${context.utils.matcherHint(matcher, undefined, undefined, { isNot: context.isNot })}\n\n` +
      `${matcher}() needs a Page or a Locator. Received: ${context.utils.printReceived(received)}`,
  );
}

/**
 * Asks until the answers are what the matcher wants, the page stops changing,
 * or time runs out. Jev is asked again only when the page state changes. A
 * page that looks like it's loading gets the full timeout to settle.
 */
async function askUntilSettled<Qs extends Questions>(
  ai: AiRuntime,
  target: Page | Locator,
  questions: Qs,
  decide: (answers: Answers<WithLoading<Qs>>) => boolean,
  isNot: boolean,
  timeout: number,
): Promise<Settled<Qs>> {
  const deadline = Date.now() + timeout;
  const all = { ...questions, loading: LOADING } as WithLoading<Qs>;
  let lastHash: string | undefined;
  let last: Settled<Qs> | undefined;
  let waitUntil = deadline;
  let calls = 0;
  for (let round = 0; ; round++) {
    const { state, hash } = await ai.capture(target);
    if (hash !== lastHash && calls < MAX_CALLS) {
      lastHash = hash;
      calls++;
      const result = await ai.evaluate({ state, questions: all });
      const pass = decide(result.answers);
      const loading = result.answers.loading.probability >= 0.5;
      last = { result, state, pass, loading, timedOut: false, calls };
      if (pass !== isNot) return last;
      waitUntil = loading ? deadline : Math.min(deadline, Date.now() + SETTLE_MS);
    }
    const now = Date.now();
    if (now >= waitUntil || ai.signal.aborted) return { ...last!, timedOut: now >= deadline, calls };
    await new Promise((resolve) => setTimeout(resolve, Math.min([100, 250, 500][round] ?? 500, waitUntil - now)));
  }
}

const fixed = (value: number): string => value.toFixed(2);

function footer<Qs extends Questions>(settled: Settled<Qs>, timeout: number): string[] {
  const { state } = settled;
  const lines = [`Page: ${state.url}${state.title ? ` "${state.title}"` : ""}${state.element ? `, element ${state.element}` : ""}`];
  if (settled.loading && settled.timedOut) lines.push(`The page still looked like it was loading after ${timeout}ms.`);
  lines.push(`Model: ${settled.result.model}, ${settled.calls} call${settled.calls === 1 ? "" : "s"}`);
  return lines;
}

function hint(context: MatcherContext, matcher: string, target: Page | Locator, expected: string): string {
  return context.utils.matcherHint(matcher, isPage(target) ? "page" : "locator", expected, {
    isNot: context.isNot,
    promise: context.promise,
  });
}

async function toSatisfy(this: MatcherContext, received: unknown, claim: string, options?: AiMatcherOptions): Promise<MatcherResult> {
  const target = requireTarget(this, "toSatisfy", received);
  if (typeof claim !== "string" || !claim.trim()) {
    throw new Error('toSatisfy() needs a claim, such as "the cart shows 3 items".');
  }
  const ai = runtime("toSatisfy");
  const isNot = Boolean(this.isNot);
  const min = options?.minProbability ?? ai.settings.minProbability;
  const timeout = expectTimeout(options);

  return asStep(
    this,
    `toSatisfy(${JSON.stringify(claim)})`,
    async () => {
      const startTime = Date.now();
      const settled = await askUntilSettled(
        ai,
        target,
        { claim: { type: "boolean", instructions: claim } as BooleanQuestion },
        (answers) => (isNot ? answers.claim.probability > 1 - min : answers.claim.probability >= min),
        isNot,
        timeout,
      );
      const probability = settled.result.answers.claim.probability;
      ai.record({
        kind: "assertion",
        question: isNot ? `not: ${claim}` : claim,
        ...describeAnswer(settled.result.answers.claim),
        passed: settled.pass !== isNot,
        model: settled.result.model,
        startTime,
        durationMs: Date.now() - startTime,
      });
      const needed = isNot ? `at most ${fixed(1 - min)}` : `at least ${fixed(min)}`;
      return {
        pass: settled.pass,
        message: () =>
          [
            hint(this, "toSatisfy", target, "claim"),
            "",
            `Claim: ${claim}`,
            `Probability: ${fixed(probability)}, needed ${needed}`,
            ...footer(settled, timeout),
          ].join("\n"),
      };
    },
    "ai",
  );
}

async function toSatisfyAll(this: MatcherContext, received: unknown, claims: string[], options?: AiMatcherOptions): Promise<MatcherResult> {
  const target = requireTarget(this, "toSatisfyAll", received);
  if (!Array.isArray(claims) || claims.length === 0 || claims.some((claim) => typeof claim !== "string" || !claim.trim())) {
    throw new Error("toSatisfyAll() needs a list of claims.");
  }
  const ai = runtime("toSatisfyAll");
  const isNot = Boolean(this.isNot);
  const min = options?.minProbability ?? ai.settings.minProbability;
  const timeout = expectTimeout(options);
  const questions: Record<string, BooleanQuestion> = {};
  claims.forEach((claim, index) => (questions[`claim${index}`] = { type: "boolean", instructions: claim }));
  const holds = (probability: number): boolean => (isNot ? probability <= 1 - min : probability >= min);

  return asStep(
    this,
    `toSatisfyAll(${claims.length} claims)`,
    async () => {
      const startTime = Date.now();
      const settled = await askUntilSettled(
        ai,
        target,
        questions,
        (answers) => {
          const all = claims.every((_, index) => holds(answers[`claim${index}`]!.probability));
          return isNot ? !all : all;
        },
        isNot,
        timeout,
      );
      const probabilities = claims.map((_, index) => settled.result.answers[`claim${index}`]!.probability);
      claims.forEach((claim, index) =>
        ai.record({
          kind: "assertion",
          question: isNot ? `not: ${claim}` : claim,
          ...describeAnswer(settled.result.answers[`claim${index}`]!),
          passed: holds(probabilities[index]!),
          model: settled.result.model,
          startTime,
          durationMs: Date.now() - startTime,
        }),
      );
      const needed = isNot ? `at most ${fixed(1 - min)}` : `at least ${fixed(min)}`;
      return {
        pass: settled.pass,
        message: () =>
          [
            hint(this, "toSatisfyAll", target, "claims"),
            "",
            `Each claim needs a probability ${needed}${isNot ? " (none may hold)" : ""}:`,
            ...claims.map((claim, index) => `  ${holds(probabilities[index]!) ? "✓" : "✗"} ${fixed(probabilities[index]!)}  ${claim}`),
            "",
            ...footer(settled, timeout),
          ].join("\n"),
      };
    },
    "ai",
  );
}

async function toScore(
  this: MatcherContext,
  received: unknown,
  question: string,
  levels: string[],
  options: ScoreMatcherOptions = {},
): Promise<MatcherResult> {
  const target = requireTarget(this, "toScore", received);
  if (!Array.isArray(levels) || levels.length < 2 || levels.length > 10) {
    throw new Error("toScore() needs from 2 to 10 levels, lowest first.");
  }
  if (options.atLeast === undefined && options.atMost === undefined) {
    throw new Error("toScore() needs atLeast, atMost, or both, such as { atLeast: 2 }.");
  }
  const ai = runtime("toScore");
  const isNot = Boolean(this.isNot);
  const timeout = expectTimeout(options);
  const inRange = (score: number): boolean =>
    (options.atLeast === undefined || score >= options.atLeast) && (options.atMost === undefined || score <= options.atMost);

  return asStep(
    this,
    `toScore(${JSON.stringify(question)})`,
    async () => {
      const startTime = Date.now();
      const settled = await askUntilSettled(
        ai,
        target,
        { rating: { type: "score", instructions: question, criteria: levels } as ScoreQuestion },
        (answers) => inRange(answers.rating.score),
        isNot,
        timeout,
      );
      const { score } = settled.result.answers.rating;
      ai.record({
        kind: "assertion",
        question,
        ...describeAnswer(settled.result.answers.rating),
        passed: settled.pass !== isNot,
        model: settled.result.model,
        startTime,
        durationMs: Date.now() - startTime,
      });
      const range = [options.atLeast !== undefined && `at least ${options.atLeast}`, options.atMost !== undefined && `at most ${options.atMost}`]
        .filter(Boolean)
        .join(" and ");
      return {
        pass: settled.pass,
        message: () =>
          [
            hint(this, "toScore", target, "question, levels"),
            "",
            `Question: ${question}`,
            `Score: ${fixed(score)} on levels 0 to ${levels.length - 1}, needed ${isNot ? "not " : ""}${range}`,
            `Levels: ${levels.map((level, index) => `${index} ${level}`).join(" · ")}`,
            ...footer(settled, timeout),
          ].join("\n"),
      };
    },
    "ai",
  );
}

export const aiMatchers: Record<string, (this: MatcherContext, received: unknown, ...args: any[]) => Promise<MatcherResult>> = {
  toSatisfy,
  toSatisfyAll,
  toScore,
};
