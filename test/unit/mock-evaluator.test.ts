import { describe, expect, test } from "vitest";
import { resolveJev } from "../../src/ai/providers/resolve.js";
import { createMockEvaluator } from "../../src/testing/index.js";
import { SPAM_EMAIL, SPAM_QUESTIONS } from "../helpers/spam.js";

describe("createMockEvaluator", () => {
  test("expands shorthand answers and records each call", async () => {
    const mock = createMockEvaluator(() => ({ isSpam: true, category: "phishing", riskScore: 4 }));
    const result = await mock.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(result.answers).toEqual({
      isSpam: { type: "boolean", probability: 1 },
      category: {
        type: "choice",
        choice: "phishing",
        probabilities: { phishing: 1, marketing: 0, personal: 0, transactional: 0 },
        confidence: 1,
      },
      riskScore: { type: "score", score: 4, probabilities: [0, 0, 0, 0, 1], confidence: 1 },
    });
    expect(result.model).toBe("mock");
    expect(result.usage.inputTokens).toBeGreaterThan(300);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.state).toBe(SPAM_EMAIL);

    mock.reset();
    expect(mock.calls).toHaveLength(0);
  });

  test("lets the handler decide from the questions", async () => {
    const mock = createMockEvaluator(({ questions }) =>
      Object.fromEntries(Object.keys(questions).map((key) => [key, key === "loud" ? 0.9 : 0.1])),
    );
    const result = await mock.evaluate({
      state: "HELLO",
      questions: {
        loud: { type: "boolean", instructions: "Is it shouted?" },
        quiet: { type: "boolean", instructions: "Is it whispered?" },
      },
    });
    expect(result.answers.loud.probability).toBe(0.9);
    expect(result.answers.quiet.probability).toBe(0.1);
  });

  test("names the question it has no answer for", async () => {
    const mock = createMockEvaluator(() => ({ isSpam: 0.5 }));
    await expect(mock.evaluate({ state: "x", questions: SPAM_QUESTIONS })).rejects.toThrow(
      'mock returned an invalid answer: there is no answer for question "category".',
    );
  });

  test("rejects a shorthand that doesn't fit the question", async () => {
    const mock = createMockEvaluator(() => ({ isSpam: "yes" }));
    await expect(mock.evaluate({ state: "x", questions: { isSpam: SPAM_QUESTIONS.isSpam } })).rejects.toThrow(
      'The mock answer for question "isSpam" is "yes", which doesn\'t fit a boolean question.',
    );
  });

  test("works as ai.provider", async () => {
    const mock = createMockEvaluator(() => ({ isSpam: 0.97 }), { name: "offline" });
    const jev = resolveJev({ provider: mock }, {});
    const result = await jev?.evaluator.evaluate({ state: "x", questions: { isSpam: SPAM_QUESTIONS.isSpam } });

    expect(jev?.provider).toBe("offline");
    expect(result?.answers.isSpam.probability).toBe(0.97);
    expect(jev?.usage.totals()).toMatchObject({ calls: 1, costUsd: 0, models: ["offline"] });
  });
});
