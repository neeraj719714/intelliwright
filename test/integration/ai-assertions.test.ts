import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";
import { startFakeServer } from "../helpers/fake-server.js";

const project = path.join(projectsDir, "ai-mock");
const NO_KEYS = {
  TYPESAFE_API_KEY: "",
  AI_GATEWAY_API_KEY: "",
  VERCEL_OIDC_TOKEN: "",
  OPENROUTER_API_KEY: "",
  CLOUDFLARE_API_TOKEN: "",
};

interface Attempt {
  duration: number;
  errors: Array<{ message: string }>;
  ai?: { provider: string; usage: { calls: number }; decisions: Array<{ kind: string; question: string; probability?: number; passed?: boolean }> };
}
interface Result {
  titlePath: string[];
  tags: string[];
  outcome: string;
  attempts: Attempt[];
}

function readResults(): { tests: Result[]; ai?: { provider: string; usage: { calls: number } } } {
  return JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8"));
}

beforeAll(() => linkIntelliwright(project));

describe("with the mock evaluator", () => {
  let results: ReturnType<typeof readResults>;
  const attempt = (title: string): Attempt => results.tests.find((test) => test.titlePath.at(-1) === title)!.attempts.at(-1)!;
  const outcome = (title: string): string => results.tests.find((test) => test.titlePath.at(-1) === title)!.outcome;

  beforeAll(async () => {
    await runCli(["test"], { cwd: project, env: NO_KEYS });
    results = readResults();
  });

  test("checks pass and fail by the probability threshold, and .not by 1 - threshold", () => {
    expect(outcome("a claim at the threshold passes")).toBe("passed");
    expect(outcome("a claim just below the threshold fails")).toBe("failed");
    expect(outcome("minProbability can be raised for one check")).toBe("failed");
    expect(outcome(".not passes at 1 - minProbability or below")).toBe("passed");
    expect(outcome(".not fails when Jev is unsure")).toBe("failed");

    const below = attempt("a claim just below the threshold fails").errors[0]!.message;
    expect(below).toContain("Claim: [p=0.69] the page greets the visitor");
    expect(below).toContain("Probability: 0.69, needed at least 0.70");
    expect(attempt(".not fails when Jev is unsure").errors[0]!.message).toContain("Probability: 0.31, needed at most 0.30");
    expect(attempt("minProbability can be raised for one check").errors[0]!.message).toContain("needed at least 0.90");
  });

  test("retries only when the page changes, and keeps waiting while it loads", () => {
    const loading = attempt("waits while the page is loading and asks again when it changes");
    expect(outcome("waits while the page is loading and asks again when it changes")).toBe("passed");
    expect(loading.ai!.usage.calls).toBe(2);

    const unchanged = attempt("doesn't ask again while the page stays the same");
    expect(unchanged.ai!.usage.calls).toBe(1);
    expect(unchanged.errors[0]!.message).toContain("The page still looked like it was loading after 1000ms.");

    const settled = attempt("fails early once the page has settled");
    expect(settled.ai!.usage.calls).toBe(1);
    expect(settled.duration).toBeLessThan(5_000);
  });

  test("toSatisfyAll asks every claim in one call and lists them all when one fails", () => {
    expect(outcome("toSatisfyAll checks several claims in one request")).toBe("passed");
    expect(attempt("toSatisfyAll checks several claims in one request").ai!.usage.calls).toBe(1);
    const message = attempt("toSatisfyAll lists every claim when one fails").errors[0]!.message;
    expect(message).toContain('✓ 0.95  the heading says "Shop"');
    expect(message).toContain('✗ 0.05  the page says "Cart: 3 items"');
  });

  test("toScore, locator scopes and ai.evaluate", () => {
    expect(outcome("toScore rates the page")).toBe("passed");
    expect(outcome("a locator scopes the claim to one element")).toBe("passed");
    expect(outcome("ai.evaluate answers typed questions and never sees secrets")).toBe("passed");
  });

  test("decisions and usage are recorded for reports", () => {
    const decisions = attempt("a claim at the threshold passes").ai!.decisions;
    expect(decisions).toMatchObject([
      { kind: "assertion", question: "[p=0.70] the page greets the visitor", probability: 0.7, passed: true },
    ]);
    expect(results.ai?.provider).toBe("mock");
    expect(results.ai?.usage.calls).toBe(results.tests.reduce((sum, test) => sum + (test.attempts.at(-1)!.ai?.usage.calls ?? 0), 0));
  });
});

test("against a fake server, toSatisfyAll with three claims sends exactly one request", async () => {
  const server = await startFakeServer((request) => {
    const { questions } = request.body as { questions: Record<string, { type: string }> };
    const answers = Object.fromEntries(Object.keys(questions).map((key) => [key, { type: "noul", noul: key === "loading" ? 0.05 : 0.95 }]));
    return { json: { model: "jev-1.13.0", answers, usage: { input_tokens: 400, output_tokens: 40 } } };
  });
  try {
    const run = await runCli(["test", "--grep", "toSatisfyAll checks several claims"], {
      cwd: project,
      env: { ...NO_KEYS, FAKE_JEV_URL: server.url },
    });
    expect(run.code).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.path).toBe("/v1/systemone");
    expect(Object.keys((server.requests[0]!.body as { questions: object }).questions)).toEqual(["claim0", "claim1", "claim2", "loading"]);
    expect(readResults().ai).toMatchObject({ provider: "Fake Jev", usage: { calls: 1, inputTokens: 400 } });
  } finally {
    await server.close();
  }
});

test("without a provider, AI checks explain how to set one up", async () => {
  await runCli(["test", "--grep", "a claim at the threshold passes"], { cwd: project, env: { ...NO_KEYS, NO_PROVIDER: "1" } });
  const [result] = readResults().tests;
  expect(result!.outcome).toBe("failed");
  expect(result!.attempts[0]!.errors[0]!.message).toContain("No Jev provider is configured, so AI checks and actions can't run.");
});
