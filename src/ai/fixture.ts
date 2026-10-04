import type { Locator, Page } from "playwright-core";
import { resolveTarget, type ActionOptions } from "./actions.js";
import { GoalNotReachedError, runGoal, type RunOptions, type RunResult } from "./agent.js";
import type { ActionKind } from "./candidates.js";
import { describeAnswer, describeQuestion, type AiRuntime } from "./runtime.js";
import type { Answers, Questions } from "./types.js";

export interface EvaluateQuestionsOptions {
  /** Ask about one element instead of the whole page. */
  scope?: Locator;
}

export interface CheckOptions extends ActionOptions {
  /** Defaults to true. Pass false to uncheck. */
  checked?: boolean;
}

export type { ActionOptions, RunOptions, RunResult };

/** Jev-powered helpers bound to the test's page. Available as the `ai` fixture. */
export interface Ai {
  /**
   * Asks Jev typed questions about the current page and returns its answers.
   * The page state is captured and attached for you.
   */
  evaluate<Qs extends Questions>(questions: Qs, options?: EvaluateQuestionsOptions): Promise<Answers<Qs>>;
  /** Clicks the element that fits a plain-English description. */
  click(description: string, options?: ActionOptions): Promise<void>;
  /** Types `value` into the text field that fits the description. */
  fill(description: string, value: string, options?: ActionOptions): Promise<void>;
  /** Picks options in the select box that fits the description. */
  select(description: string, value: string | string[], options?: ActionOptions): Promise<void>;
  /** Checks, or with `{ checked: false }` unchecks, the checkbox, radio button or switch that fits. */
  check(description: string, options?: CheckOptions): Promise<void>;
  /** Hovers the element that fits the description. */
  hover(description: string, options?: ActionOptions): Promise<void>;
  /** Returns a normal Playwright locator for the element that fits the description. */
  locate(description: string, options?: ActionOptions): Promise<Locator>;
  /**
   * Works towards a plain-English goal one click or fill at a time, and
   * throws if the goal isn't reached. Text comes from `data`. The result,
   * and the report, include the same flow as fixed Playwright code.
   */
  run(goal: string, options?: RunOptions): Promise<RunResult>;
}

export function createAi(page: Page, runtime: AiRuntime): Ai {
  const act = <T>(kind: ActionKind, description: string, options: ActionOptions | undefined, use: (locator: Locator) => Promise<T>, extra = ""): Promise<T> =>
    runtime.step(`ai.${kind}(${JSON.stringify(description)}${extra})`, async () => {
      if (typeof description !== "string" || !description.trim()) {
        throw new Error(`ai.${kind}() needs a description of the element, such as "the Sign in button".`);
      }
      const target = await resolveTarget(page, runtime, kind, description, options);
      runtime.note(`${target.cached ? "cached locator" : "chose"}: ${target.code}`);
      return use(target.locator);
    });

  return {
    evaluate<Qs extends Questions>(questions: Qs, options?: EvaluateQuestionsOptions): Promise<Answers<Qs>> {
      const keys = Object.keys(questions);
      return runtime.step(`ai.evaluate(${keys.join(", ")})`, async () => {
        const startTime = Date.now();
        const { state } = await runtime.capture(options?.scope ?? page);
        const result = await runtime.evaluate({ state, questions });
        for (const key of keys) {
          runtime.record({
            kind: "evaluate",
            question: describeQuestion(questions[key]!),
            ...describeAnswer(result.answers[key]!),
            model: result.model,
            startTime,
            durationMs: Date.now() - startTime,
          });
        }
        return result.answers;
      });
    },
    click: (description, options) => act("click", description, options, (locator) => locator.click({ timeout: options?.timeout })),
    fill: (description, value, options) =>
      act("fill", description, options, (locator) => locator.fill(value, { timeout: options?.timeout }), ", …"),
    select: (description, value, options) =>
      act("select", description, options, async (locator) => {
        await locator.selectOption(value, { timeout: options?.timeout });
      }, `, ${JSON.stringify(value)}`),
    check: (description, options) =>
      act("check", description, options, (locator) => locator.setChecked(options?.checked ?? true, { timeout: options?.timeout })),
    hover: (description, options) => act("hover", description, options, (locator) => locator.hover({ timeout: options?.timeout })),
    locate: (description, options) => act("locate", description, options, async (locator) => locator),
    run: (goal, options) =>
      runtime.step(`ai.run(${JSON.stringify(goal)})`, async () => {
        if (typeof goal !== "string" || !goal.trim()) throw new Error('ai.run() needs a goal, such as "sign up for the newsletter".');
        const result = await runGoal(page, runtime, goal, options);
        if (!result.goalMet) throw new GoalNotReachedError(result);
        return result;
      }),
  };
}
