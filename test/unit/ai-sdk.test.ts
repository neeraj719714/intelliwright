import { APICallError } from "ai";
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from "ai/test";
import { describe, expect, test } from "vitest";
import { fromAiSdk } from "../../src/ai-sdk/index.js";
import { isJevError, type JevError } from "../../src/ai/errors.js";
import { resolveJev } from "../../src/ai/providers/resolve.js";
import type { Questions } from "../../src/ai/types.js";

const questions = {
  cart: { type: "boolean", instructions: "Does the page show a cart?" },
  plan: { type: "choice", instructions: "Which plan is selected?", criteria: { free: "The Free plan", pro: null } },
  clarity: { type: "score", instructions: "How clear is the message?", criteria: ["Unclear", "Somewhat clear", "Clear"] },
} satisfies Questions;

const state = { url: "https://example.com/cart", aria: "- heading \"Your cart\" [level=1]" };

function jevFor(model: MockEvaluationModel, options?: Parameters<typeof fromAiSdk>[1]) {
  const jev = resolveJev({ provider: fromAiSdk(model, options) }, {});
  if (!jev) throw new Error("no Jev");
  return jev;
}

describe("fromAiSdk", () => {
  test("sends the questions unchanged and converts the answers", async () => {
    const calls: unknown[] = [];
    const model = new MockEvaluationModel({
      provider: "mock-provider",
      modelId: "mock-jev",
      doEvaluate: async (options) => {
        calls.push({ state: options.state, questions: options.questions, signal: options.abortSignal instanceof AbortSignal });
        return {
          answers: {
            cart: { type: "boolean", probability: 0.93 },
            plan: { type: "choice", choice: "pro", probabilities: { free: 0.1, pro: 0.9 } },
            clarity: { type: "score", score: 1.8, probabilities: { "0": 0, "1": 0.2, "2": 0.8 } },
          },
          usage: { inputTokens: 412, outputTokens: 9 },
          warnings: [],
          response: { modelId: "mock-jev-1.2.0" },
        };
      },
    });
    const jev = jevFor(model);
    expect(jev.provider).toBe("mock-provider/mock-jev");

    const result = await jev.evaluator.evaluate({ state, questions }, { signal: new AbortController().signal });
    expect(calls).toEqual([{ state, questions, signal: true }]);
    expect(result.answers).toEqual({
      cart: { type: "boolean", probability: 0.93 },
      plan: { type: "choice", choice: "pro", probabilities: { free: 0.1, pro: 0.9 } },
      clarity: { type: "score", score: 1.8, probabilities: [0, 0.2, 0.8] },
    });
    expect(result.model).toBe("mock-jev-1.2.0");
    expect(result.usage).toEqual({ inputTokens: 412, outputTokens: 9 });
    expect(jev.usage.totals()).toMatchObject({ calls: 1, inputTokens: 412, models: ["mock-jev-1.2.0"] });
  });

  test("treats answers without probabilities as certain", async () => {
    const model = new MockEvaluationModel({
      doEvaluate: async () => ({
        answers: {
          cart: { type: "boolean", probability: 0.2 },
          plan: { type: "choice", choice: "free" },
          clarity: { type: "score", score: 1.25 },
        },
        warnings: [],
      }),
    });
    const { answers } = await jevFor(model).evaluator.evaluate({ state, questions });
    expect(answers.plan).toEqual({ type: "choice", choice: "free", probabilities: { free: 1, pro: 0 } });
    expect(answers.clarity).toEqual({ type: "score", score: 1.25, probabilities: [0, 0.75, 0.25] });
  });

  test("turns API failures into JevErrors named after the model", async () => {
    const failing = (statusCode: number) =>
      new MockEvaluationModel({
        provider: "mock-provider",
        modelId: "mock-jev",
        doEvaluate: async () => {
          throw new APICallError({ message: "Nope", url: "https://example.com", requestBodyValues: {}, statusCode, isRetryable: statusCode >= 429 });
        },
      });

    const auth = await jevFor(failing(401)).evaluator.evaluate({ state, questions }).catch((error: unknown) => error);
    expect(isJevError(auth)).toBe(true);
    expect(auth).toMatchObject({ kind: "auth", status: 401, provider: "mock-provider/mock-jev" });
    expect((auth as JevError).message).toBe("mock-provider/mock-jev failed with status 401: Nope");

    const limited = await jevFor(failing(429), { maxRetries: 1, name: "my evaluator" })
      .evaluator.evaluate({ state, questions })
      .catch((error: unknown) => error);
    expect(limited).toMatchObject({ kind: "rate_limited", status: 429, provider: "my evaluator" });
  });

  test("names unsupported question types", async () => {
    const model = new MockEvaluationModel({ supportedQuestionTypes: ["boolean", "choice"] });
    const error = await jevFor(model).evaluator.evaluate({ state, questions }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: "invalid_request" });
    expect((error as JevError).message).toContain("doesn't support score questions");
  });

  test("rejects answers that don't fit the questions", async () => {
    const model = new MockEvaluationModel({
      doEvaluate: async () => ({ answers: { cart: { type: "boolean", probability: 0.5 } }, warnings: [] }),
    });
    const error = await jevFor(model).evaluator.evaluate({ state, questions }).catch((caught: unknown) => caught);
    expect(isJevError(error)).toBe(true);
    expect(error).toMatchObject({ kind: "invalid_answer" });
  });
});
