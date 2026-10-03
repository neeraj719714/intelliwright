import { describe, expect, test } from "vitest";
import { planRequests, withBatching } from "../../src/ai/batching.js";
import type { BooleanQuestion } from "../../src/ai/types.js";
import { createMockEvaluator } from "../../src/testing/index.js";

const yesNo = (i: number): BooleanQuestion => ({
  type: "boolean",
  instructions: `Is statement ${i} true? ${"detail ".repeat(40)}`,
});

function manyQuestions(count: number): Record<string, BooleanQuestion> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i}`, yesNo(i)]));
}

describe("planRequests", () => {
  test("keeps everything in one request when it fits", () => {
    expect(planRequests("state", manyQuestions(3), { request: 32_000, stateAndQuestion: 32_000 }, "Test")).toHaveLength(1);
  });

  test("splits questions across requests that each fit the budget", () => {
    const groups = planRequests("x".repeat(3_000), manyQuestions(12), { request: 2_500, stateAndQuestion: 2_500 }, "Test");
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flatMap((group) => Object.keys(group))).toEqual(Object.keys(manyQuestions(12)));
  });

  test("fails when the state and one question can't fit", () => {
    expect(() =>
      planRequests("x".repeat(90_000), manyQuestions(1), { request: 32_000, stateAndQuestion: 32_000 }, "Test"),
    ).toThrow(/more than Test accepts in one request/);
  });
});

describe("withBatching", () => {
  test("splits an oversized batch, sends the parts in parallel and merges the answers", async () => {
    const mock = createMockEvaluator(({ questions }) =>
      Object.fromEntries(Object.keys(questions).map((key) => [key, Number(key.slice(1)) / 100])),
    );
    const batched = withBatching(mock, { budget: { request: 2_500, stateAndQuestion: 2_500 }, provider: "Test" });
    const result = await batched.evaluate({ state: "x".repeat(3_000), questions: manyQuestions(12) });

    expect(mock.calls.length).toBeGreaterThan(1);
    expect(Object.keys(result.answers)).toHaveLength(12);
    expect(result.answers.q7?.probability).toBe(0.07);
  });

  test("an aborted caller is rejected while the others still get answers", async () => {
    const mock = createMockEvaluator(() => ({ a: 0.4, b: 0.6 }));
    const batched = withBatching(mock, { budget: { request: 32_000, stateAndQuestion: 32_000 }, provider: "Test" });
    const controller = new AbortController();
    const first = batched.evaluate(
      { state: "same", questions: { a: { type: "boolean", instructions: "A?" } } },
      { signal: controller.signal },
    );
    const second = batched.evaluate({ state: "same", questions: { b: { type: "boolean", instructions: "B?" } } });
    controller.abort(new Error("gave up"));

    await expect(first).rejects.toThrow("gave up");
    expect((await second).answers.b.probability).toBe(0.6);
    expect(mock.calls).toHaveLength(1);
    expect(Object.keys(mock.calls[0]?.questions ?? {})).toEqual(["b"]);
  });
});
