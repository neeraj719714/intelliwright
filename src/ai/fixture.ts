import type { Locator, Page } from "playwright-core";
import { describeAnswer, describeQuestion, type AiRuntime } from "./runtime.js";
import type { Answers, Questions } from "./types.js";

export interface EvaluateQuestionsOptions {
  /** Ask about one element instead of the whole page. */
  scope?: Locator;
}

/** Jev-powered helpers bound to the test's page. Available as the `ai` fixture. */
export interface Ai {
  /**
   * Asks Jev typed questions about the current page and returns its answers.
   * The page state is captured and attached for you.
   */
  evaluate<Qs extends Questions>(questions: Qs, options?: EvaluateQuestionsOptions): Promise<Answers<Qs>>;
}

export function createAi(page: Page, runtime: AiRuntime): Ai {
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
  };
}
