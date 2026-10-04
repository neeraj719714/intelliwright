import type { EvaluateRequest } from "intelliwright";
import type { MockAnswer } from "intelliwright/testing";

/**
 * Labels a failure from the evidence it was sent: failed requests mean the
 * environment, a timeout on a page still loading means flaky, a locator that
 * never appeared means a test bug, anything else a regression.
 */
export function triageJudge({ state, questions }: EvaluateRequest): Record<string, MockAnswer> {
  const facts = (typeof state === "object" && state !== null ? state : {}) as {
    error?: string;
    failedRequests?: string[];
    page?: { aria?: string };
  };
  const answers: Record<string, MockAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    if (key === "severity") {
      answers[key] = 2;
    } else if (key === "cause" && question.type === "choice") {
      const label = facts.failedRequests?.length
        ? "environment"
        : /Timed out/.test(facts.error ?? "") && /Loading/.test(facts.page?.aria ?? "")
          ? "flaky"
          : /waiting for/.test(facts.error ?? "")
            ? "test_bug"
            : "regression";
      const probabilities = Object.fromEntries(Object.keys(question.criteria).map((option) => [option, option === label ? 0.9 : 0.1 / 3]));
      answers[key] = { type: "choice", choice: label, probabilities, confidence: 0.8 };
    }
  }
  return answers;
}
