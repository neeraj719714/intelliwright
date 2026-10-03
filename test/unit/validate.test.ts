import { describe, expect, test } from "vitest";
import { validateAnswers } from "../../src/ai/validate.js";
import type { Questions } from "../../src/ai/types.js";

const questions = {
  ok: { type: "boolean", instructions: "Is it ok?" },
  pick: { type: "choice", instructions: "Pick one", criteria: { a: "First", b: null, c: "Third" } },
  rate: { type: "score", instructions: "Rate it", criteria: ["Low", "Mid", "High"] },
} satisfies Questions;

const valid = {
  ok: { type: "boolean", probability: 0.8 },
  pick: { type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.9 }, confidence: 0.7 },
  rate: { type: "score", score: 1.2, probabilities: { "1": 0.8, "2": 0.2 } },
};

describe("validateAnswers", () => {
  test("accepts valid answers and fills in missing probabilities", () => {
    expect(validateAnswers(questions, valid, "Test")).toEqual({
      ok: { type: "boolean", probability: 0.8 },
      pick: { type: "choice", choice: "b", probabilities: { a: 0.1, b: 0.9, c: 0 }, confidence: 0.7 },
      rate: { type: "score", score: 1.2, probabilities: [0, 0.8, 0.2] },
    });
  });

  test("clamps values within rounding of the bounds", () => {
    const result = validateAnswers(
      { ok: questions.ok },
      { ok: { type: "boolean", probability: 1.0000001 } },
      "Test",
    );
    expect(result.ok.probability).toBe(1);
  });

  test.each([
    ["no answers object", null, "the response has no answers object"],
    ["a missing answer", { ...valid, rate: undefined }, 'there is no answer for question "rate"'],
    ["a negative probability", { ...valid, ok: { type: "boolean", probability: -0.2 } }, "is -0.2, not a number from 0 to 1"],
    ["a non-number probability", { ...valid, ok: { type: "boolean", probability: "high" } }, 'is "high", not a number from 0 to 1'],
    [
      "an unknown option in probabilities",
      { ...valid, pick: { type: "choice", choice: "a", probabilities: { a: 0.5, z: 0.5 } } },
      'has a probability for "z", which is not one of the options sent',
    ],
    ["a confidence above 1", { ...valid, pick: { ...valid.pick, confidence: 2 } }, "the confidence for question \"pick\" is 2"],
    ["a score above the top level", { ...valid, rate: { type: "score", score: 2.5, probabilities: [0, 0, 1] } }, "outside the levels 0 to 2"],
    [
      "a level that was not sent",
      { ...valid, rate: { type: "score", score: 1, probabilities: { "3": 1 } } },
      'has a probability for level "3", but only levels 0 to 2 were sent',
    ],
  ])("rejects %s", (_, answers, message) => {
    expect(() => validateAnswers(questions, answers, "Test")).toThrow(message);
  });
});
