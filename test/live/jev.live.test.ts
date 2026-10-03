import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { isJevError } from "../../src/ai/errors.js";
import { createProviderClient, resolveJev } from "../../src/ai/providers/resolve.js";
import type { EvaluateResult, Questions } from "../../src/ai/types.js";
import { SPAM_EMAIL, SPAM_QUESTIONS } from "../helpers/spam.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function expectPhishingAnswers(result: EvaluateResult<typeof SPAM_QUESTIONS>): void {
  expect(result.answers.isSpam.probability).toBeGreaterThan(0.95);
  expect(result.answers.category.choice).toBe("phishing");
  expect(result.answers.riskScore.score).toBeGreaterThan(3.5);
  expect(result.model).toMatch(/jev/);
}

describe.skipIf(!process.env.TYPESAFE_API_KEY)("typesafe preset", () => {
  test("answers the phishing email", async () => {
    const jev = resolveJev({ provider: "typesafe" });
    const result = await jev!.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });
    expectPhishingAnswers(result);
    expect(jev!.usage.totals().calls).toBe(1);
  });

  test("timings: one batched request against separate requests", async () => {
    const client = createProviderClient({ provider: "typesafe" }, process.env)!;
    const timed = async (questions: Questions) => {
      const started = performance.now();
      const result = await client.evaluate({ state: SPAM_EMAIL, questions });
      return { ms: performance.now() - started, tokens: result.usage.inputTokens };
    };
    const single = Object.entries(SPAM_QUESTIONS).map(([key, question]) => ({ [key]: question }));

    const first = await timed(SPAM_QUESTIONS);
    const warm: number[] = [];
    for (let i = 0; i < 5; i++) warm.push((await timed(SPAM_QUESTIONS)).ms);

    let sequentialMs = 0;
    let separateTokens = 0;
    for (const questions of single) {
      const run = await timed(questions);
      sequentialMs += run.ms;
      separateTokens += run.tokens;
    }
    const parallelStarted = performance.now();
    await Promise.all(single.map((questions) => timed(questions)));
    const parallelMs = performance.now() - parallelStarted;
    const oneQuestion = await timed(single[0]!);

    const median = [...warm].sort((a, b) => a - b)[2]!;
    const report = {
      firstCallMs: Math.round(first.ms),
      warmBatchedMedianMs: Math.round(median),
      batchedTokens: first.tokens,
      separateSequentialMs: Math.round(sequentialMs),
      separateParallelMs: Math.round(parallelMs),
      separateTokens,
      tokensPerExtraQuestion: Math.round((first.tokens - oneQuestion.tokens) / 2),
    };
    console.log(JSON.stringify(report, null, 2));

    expect(first.tokens).toBeLessThan(separateTokens);
  });
});

describe.skipIf(!process.env.AI_GATEWAY_API_KEY)("vercel preset", () => {
  test("answers the phishing email", async (context) => {
    const jev = resolveJev({ provider: "vercel" });
    try {
      expectPhishingAnswers(await jev!.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS }));
    } catch (error) {
      if (isJevError(error) && error.status === 403 && /free tier/i.test(error.message)) {
        context.skip(error.message);
      }
      throw error;
    }
  });
});
