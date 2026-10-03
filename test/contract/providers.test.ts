import { afterEach, describe, expect, test } from "vitest";
import cloudflareSpam from "../fixtures/provider-responses/cloudflare-spam.json" with { type: "json" };
import openrouterSpam from "../fixtures/provider-responses/openrouter-spam.json" with { type: "json" };
import typesafeSpam from "../fixtures/provider-responses/typesafe-spam.json" with { type: "json" };
import { isJevError, type JevError } from "../../src/ai/errors.js";
import { resolveJev, type ProviderSettings } from "../../src/ai/providers/resolve.js";
import { redirectTo, startFakeServer, type FakeHandler, type FakeServer } from "../helpers/fake-server.js";
import { SPAM_EMAIL, SPAM_QUESTIONS, SPAM_WIRE_QUESTIONS } from "../helpers/spam.js";

const KEY = "sk-test-0123456789abcdef";
let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function setup(
  handler: FakeHandler,
  settings: ProviderSettings,
  env: Record<string, string> = { TYPESAFE_API_KEY: KEY },
) {
  server = await startFakeServer(handler);
  const seen: string[] = [];
  const jev = resolveJev({ ...settings, fetch: redirectTo(server, seen) }, env);
  if (!jev) throw new Error("no provider resolved");
  return { jev, seen, server };
}

async function rejection(promise: Promise<unknown>): Promise<JevError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!isJevError(error)) throw new Error(`expected a JevError, got ${String(error)}`);
  return error;
}

const expectedSpamAnswers = {
  isSpam: { type: "boolean", probability: 0.99 },
  category: {
    type: "choice",
    choice: "phishing",
    probabilities: { phishing: 1, marketing: 0, personal: 0, transactional: 0 },
    confidence: 1,
  },
  riskScore: { type: "score", score: 3.9, probabilities: [0, 0, 0, 0.09, 0.91], confidence: 0.92 },
};

describe("typesafe preset", () => {
  test("sends a System One request and converts the answers", async () => {
    const { jev, seen, server } = await setup(() => ({ json: typesafeSpam }), { provider: "typesafe" });

    const result = await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(seen).toEqual(["https://api.typesafe.ai/v1/systemone"]);
    const [request] = server.requests;
    expect(request?.method).toBe("POST");
    expect(request?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["user-agent"]).toMatch(/^intelliwright\//);
    expect(request?.body).toEqual({ model: "jev-latest", state: SPAM_EMAIL, questions: SPAM_WIRE_QUESTIONS });

    expect(result.answers).toEqual(expectedSpamAnswers);
    expect(result.model).toBe("jev-1.13.0");
    expect(result.usage).toEqual({ inputTokens: 546, outputTokens: 85 });
    expect(result.costEstimated).toBe(true);
    expect(result.costUsd).toBeCloseTo((546 * 0.042) / 1_000_000, 12);
    expect(jev.provider).toBe("TypeSafe");
    expect(jev.usage.totals()).toMatchObject({ calls: 1, inputTokens: 546, models: ["jev-1.13.0"] });
  });

  test("ai.model pins a version", async () => {
    const { jev, server } = await setup(() => ({ json: typesafeSpam }), {
      provider: "typesafe",
      model: "jev-1.13.0",
    });
    await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });
    expect(server.requests[0]?.body).toMatchObject({ model: "jev-1.13.0" });
  });
});

describe("vercel preset", () => {
  test("posts to the gateway's TypeSafe route with its model name", async () => {
    const { jev, seen, server } = await setup(
      () => ({ json: typesafeSpam }),
      { provider: "vercel" },
      { AI_GATEWAY_API_KEY: KEY },
    );
    const result = await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(seen).toEqual(["https://ai-gateway.vercel.sh/typesafe/v1/systemone"]);
    expect(server.requests[0]?.body).toEqual({
      model: "typesafe-ai/jev",
      state: SPAM_EMAIL,
      questions: SPAM_WIRE_QUESTIONS,
    });
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(result.answers).toEqual(expectedSpamAnswers);
  });

  test("falls back to VERCEL_OIDC_TOKEN", async () => {
    const { jev, server } = await setup(
      () => ({ json: typesafeSpam }),
      { provider: "vercel" },
      { VERCEL_OIDC_TOKEN: "oidc-token-value" },
    );
    await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });
    expect(server.requests[0]?.headers.authorization).toBe("Bearer oidc-token-value");
  });
});

describe("openrouter preset", () => {
  test("uses OpenRouter's model name and the cost it reports", async () => {
    const { jev, seen, server } = await setup(
      () => ({ json: openrouterSpam }),
      { provider: "openrouter" },
      { OPENROUTER_API_KEY: KEY },
    );
    const result = await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(seen).toEqual(["https://openrouter.ai/api/v1/systemone"]);
    expect(server.requests[0]?.body).toMatchObject({ model: "~typesafe/jev-latest" });
    expect(result.answers).toEqual(expectedSpamAnswers);
    expect(result.model).toBe("typesafe/jev-1.13-20260917");
    expect(result.costUsd).toBe(0.000022932);
    expect(result.costEstimated).toBe(false);
  });
});

describe("cloudflare preset", () => {
  const env = { CLOUDFLARE_API_TOKEN: KEY, CLOUDFLARE_ACCOUNT_ID: "acct-123" };

  test("wraps the body in input and unwraps the result envelope", async () => {
    const { jev, seen, server } = await setup(() => ({ json: cloudflareSpam }), { provider: "cloudflare" }, env);
    const result = await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(seen).toEqual(["https://api.cloudflare.com/client/v4/accounts/acct-123/ai/run"]);
    expect(server.requests[0]?.body).toEqual({
      model: "typesafe/jev",
      input: { state: SPAM_EMAIL, questions: SPAM_WIRE_QUESTIONS },
    });
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(result.answers).toEqual(expectedSpamAnswers);
    expect(jev.provider).toBe("Cloudflare Workers AI");
  });

  test("reports success: false as an error", async () => {
    const { jev } = await setup(
      () => ({ json: { success: false, errors: [{ code: 5007, message: "No such model" }], result: null } }),
      { provider: "cloudflare" },
      env,
    );
    const error = await rejection(jev.evaluator.evaluate({ state: "x", questions: { a: SPAM_QUESTIONS.isSpam } }));
    expect(error.message).toContain("No such model");
  });

  test("needs the account id", () => {
    expect(() => resolveJev({ provider: "cloudflare" }, { CLOUDFLARE_API_TOKEN: KEY })).toThrow(
      /CLOUDFLARE_ACCOUNT_ID/,
    );
  });
});

describe("custom providers", () => {
  test("a { baseURL } host gets the System One request", async () => {
    server = await startFakeServer(() => ({ json: typesafeSpam }));
    const jev = resolveJev({ provider: { baseURL: `${server.url}/jev/`, apiKey: KEY, model: "jev-1.13.0" } }, {});
    const result = await jev?.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });

    expect(server.requests[0]?.path).toBe("/jev/v1/systemone");
    expect(server.requests[0]?.body).toMatchObject({ model: "jev-1.13.0" });
    expect(result?.answers).toEqual(expectedSpamAnswers);
    expect(jev?.provider).toBe(new URL(server.url).host);
  });

  test("an evaluate function has its answers validated", async () => {
    const jev = resolveJev(
      {
        provider: {
          name: "my-service",
          evaluate: async () => ({ answers: { pick: { type: "choice", choice: "nope", probabilities: { nope: 1 } } } }),
        },
      },
      {},
    );
    const error = await rejection(
      jev!.evaluator.evaluate({
        state: "x",
        questions: { pick: { type: "choice", instructions: "Pick one", criteria: { a: null, b: null } } },
      }),
    );
    expect(error.kind).toBe("invalid_answer");
    expect(error.message).toBe(
      'my-service returned an invalid answer: question "pick" was answered with "nope", which is not one of the options sent (a, b).',
    );
  });
});

describe("errors", () => {
  const ask = (jev: NonNullable<ReturnType<typeof resolveJev>>, signal?: AbortSignal) =>
    jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS }, { signal });

  test("401 fails at once, names the provider and key, and never shows the key", async () => {
    const { jev, server } = await setup(
      () => ({ status: 401, json: { detail: `Invalid API key ${KEY}` } }),
      { provider: "typesafe" },
    );
    const error = await rejection(ask(jev));

    expect(server.requests).toHaveLength(1);
    expect(error.kind).toBe("auth");
    expect(error.status).toBe(401);
    expect(error.message).toBe(
      "TypeSafe rejected the API key (401): Invalid API key [redacted]. Check TYPESAFE_API_KEY.",
    );
    const everything = [error.message, error.stack, JSON.stringify(error), String(error.cause)].join("\n");
    expect(everything).not.toContain(KEY);
  });

  test("422 fails at once and names the rejected field", async () => {
    const { jev, server } = await setup(
      () => ({
        status: 422,
        json: { detail: [{ loc: ["body", "questions", "category", "criteria"], msg: "Field required", type: "missing" }] },
      }),
      { provider: "typesafe" },
    );
    const error = await rejection(ask(jev));

    expect(server.requests).toHaveLength(1);
    expect(error.kind).toBe("invalid_request");
    expect(error.message).toBe('TypeSafe rejected the request (422) at "questions.category.criteria": Field required');
  });

  test("429 waits for retry-after, then retries", async () => {
    const { jev, server } = await setup(
      (_, index) =>
        index === 0
          ? { status: 429, headers: { "retry-after": "1" }, json: { detail: "Too many requests" } }
          : { json: typesafeSpam },
      { provider: "typesafe" },
    );
    const started = performance.now();
    const result = await ask(jev);

    expect(server.requests).toHaveLength(2);
    expect(performance.now() - started).toBeGreaterThanOrEqual(950);
    expect(result.answers.category.choice).toBe("phishing");
  });

  test("529 is retried with backoff", async () => {
    const { jev, server } = await setup(
      (_, index) => (index === 0 ? { status: 529, json: { detail: "Overloaded" } } : { json: typesafeSpam }),
      { provider: "typesafe" },
    );
    const result = await ask(jev);
    expect(server.requests).toHaveLength(2);
    expect(result.answers.isSpam.probability).toBe(0.99);
  });

  test("gives up after maxRetries and reports the last response", async () => {
    const { jev, server } = await setup(() => ({ status: 503, json: { detail: "Down for maintenance" } }), {
      provider: "typesafe",
      maxRetries: 1,
    });
    const error = await rejection(ask(jev));
    expect(server.requests).toHaveLength(2);
    expect(error.kind).toBe("server");
    expect(error.message).toBe("TypeSafe failed after 2 attempts. Last response: 503 Down for maintenance");
  });

  test.each([
    ["a missing answer", { isSpam: { type: "noul", noul: 0.5 } }, 'there is no answer for question "category"'],
    [
      "a probability above 1",
      { ...typesafeSpam.answers, isSpam: { type: "noul", noul: 1.5 } },
      'the probability for question "isSpam" is 1.5, not a number from 0 to 1',
    ],
    [
      "an option that was not sent",
      { ...typesafeSpam.answers, category: { type: "choice", choice: "scam", probabilities: { scam: 1 } } },
      'question "category" was answered with "scam", which is not one of the options sent',
    ],
    [
      "the wrong answer type",
      { ...typesafeSpam.answers, riskScore: { type: "noul", noul: 0.3 } },
      'question "riskScore" is a score question, but its answer has type "boolean"',
    ],
  ])("rejects %s", async (_, answers, message) => {
    const { jev } = await setup(() => ({ json: { ...typesafeSpam, answers } }), { provider: "typesafe" });
    const error = await rejection(ask(jev));
    expect(error.kind).toBe("invalid_answer");
    expect(error.message).toContain(message);
  });

  test("rejects a response that is not JSON", async () => {
    const { jev } = await setup(() => ({ text: "<html>Bad gateway</html>" }), { provider: "typesafe" });
    const error = await rejection(ask(jev));
    expect(error.kind).toBe("invalid_answer");
    expect(error.message).toContain("not JSON");
  });

  test("times out each attempt", async () => {
    const { jev, server } = await setup(() => ({ json: typesafeSpam, delayMs: 2_000 }), {
      provider: "typesafe",
      timeout: 150,
      maxRetries: 0,
    });
    const error = await rejection(ask(jev));
    expect(server.requests).toHaveLength(1);
    expect(error.kind).toBe("timeout");
    expect(error.message).toBe("TypeSafe failed after 1 attempts. Last error: timed out after 150 ms");
  });

  test("retries network errors", async () => {
    const jev = resolveJev(
      { provider: { baseURL: "http://127.0.0.1:9", apiKey: KEY, name: "Closed port" }, maxRetries: 1 },
      {},
    );
    const error = await rejection(ask(jev!));
    expect(error.kind).toBe("network");
    expect(error.message).toMatch(/^Closed port failed after 2 attempts\. Last error: network error: fetch failed/);
  });

  test("an aborted signal stops the request", async () => {
    const { jev } = await setup(() => ({ json: typesafeSpam, delayMs: 2_000 }), { provider: "typesafe" });
    const controller = new AbortController();
    const pending = ask(jev, controller.signal);
    setTimeout(() => controller.abort(new Error("test timed out")), 50);
    const started = performance.now();
    await expect(pending).rejects.toThrow("test timed out");
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("batching", () => {
  test("three questions in one call make exactly one request", async () => {
    const { jev, server } = await setup(() => ({ json: typesafeSpam }), { provider: "typesafe" });
    await jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: SPAM_QUESTIONS });
    expect(server.requests).toHaveLength(1);
  });

  test("questions about the same state asked together are merged into one request", async () => {
    const { jev, server } = await setup(
      (request) => {
        const questions = (request.body as { questions: Record<string, unknown> }).questions;
        const answers: Record<string, unknown> = {};
        for (const key of Object.keys(questions)) {
          answers[key] = key.endsWith("isSpam") ? typesafeSpam.answers.isSpam : key.endsWith("category") ? typesafeSpam.answers.category : typesafeSpam.answers.riskScore;
        }
        return { json: { ...typesafeSpam, answers } };
      },
      { provider: "typesafe" },
    );
    const [spam, category, risk] = await Promise.all([
      jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: { isSpam: SPAM_QUESTIONS.isSpam } }),
      jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: { category: SPAM_QUESTIONS.category } }),
      jev.evaluator.evaluate({ state: SPAM_EMAIL, questions: { riskScore: SPAM_QUESTIONS.riskScore } }),
    ]);

    expect(server.requests).toHaveLength(1);
    expect(Object.keys((server.requests[0]?.body as { questions: object }).questions)).toHaveLength(3);
    expect(spam.answers).toEqual({ isSpam: expectedSpamAnswers.isSpam });
    expect(category.answers).toEqual({ category: expectedSpamAnswers.category });
    expect(risk.answers).toEqual({ riskScore: expectedSpamAnswers.riskScore });
    expect(jev.usage.totals().calls).toBe(1);
  });

  test("different states go out as separate requests", async () => {
    const { jev, server } = await setup(() => ({ json: { ...typesafeSpam, answers: { isSpam: typesafeSpam.answers.isSpam } } }), {
      provider: "typesafe",
    });
    await Promise.all([
      jev.evaluator.evaluate({ state: "first", questions: { isSpam: SPAM_QUESTIONS.isSpam } }),
      jev.evaluator.evaluate({ state: "second", questions: { isSpam: SPAM_QUESTIONS.isSpam } }),
    ]);
    expect(server.requests).toHaveLength(2);
  });

  test("caps the requests in flight per worker", async () => {
    const { jev, server } = await setup(
      () => ({ json: { ...typesafeSpam, answers: { isSpam: typesafeSpam.answers.isSpam } }, delayMs: 100 }),
      { provider: "typesafe", maxConcurrency: 2 },
    );
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        jev.evaluator.evaluate({ state: `state ${i}`, questions: { isSpam: SPAM_QUESTIONS.isSpam } }),
      ),
    );
    expect(server.requests).toHaveLength(6);
    expect(server.maxInFlight).toBe(2);
  });
});

describe("auto-detection", () => {
  const detect = (env: Record<string, string>) => resolveJev({}, env)?.provider;

  test("uses the first key it finds", () => {
    const all = {
      TYPESAFE_API_KEY: "a",
      AI_GATEWAY_API_KEY: "b",
      OPENROUTER_API_KEY: "c",
      CLOUDFLARE_API_TOKEN: "d",
      CLOUDFLARE_ACCOUNT_ID: "e",
    };
    expect(detect(all)).toBe("TypeSafe");
    expect(detect({ ...all, TYPESAFE_API_KEY: "" })).toBe("Vercel AI Gateway");
    expect(detect({ VERCEL_OIDC_TOKEN: "x", OPENROUTER_API_KEY: "c" })).toBe("Vercel AI Gateway");
    expect(detect({ OPENROUTER_API_KEY: "c", CLOUDFLARE_API_TOKEN: "d", CLOUDFLARE_ACCOUNT_ID: "e" })).toBe("OpenRouter");
    expect(detect({ CLOUDFLARE_API_TOKEN: "d", CLOUDFLARE_ACCOUNT_ID: "e" })).toBe("Cloudflare Workers AI");
  });

  test("returns nothing without a usable key", () => {
    expect(detect({})).toBeUndefined();
    expect(detect({ CLOUDFLARE_API_TOKEN: "d" })).toBeUndefined();
  });

  test("a preset without its key is a config error", () => {
    expect(() => resolveJev({ provider: "openrouter" }, {})).toThrow(
      'ai.provider is "openrouter", but OPENROUTER_API_KEY is not set. Add it to .env.local, or set ai.apiKey.',
    );
  });

  test("an unknown preset is a config error", () => {
    expect(() => resolveJev({ provider: "openai" as never }, {})).toThrow(/Unknown ai.provider "openai"/);
  });
});
