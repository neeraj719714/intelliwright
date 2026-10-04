import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli, type CliResult } from "../helpers/cli.js";

const project = path.join(projectsDir, "triage");
const NO_KEYS = { TYPESAFE_API_KEY: "", AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENROUTER_API_KEY: "", CLOUDFLARE_API_TOKEN: "" };

interface Results {
  notes: string[];
  tests: Array<{ titlePath: string[]; outcome: string; triage?: { label: string; probability?: number; severity?: number; note?: string } }>;
}
const read = (): Results => JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8"));
const labels = (results: Results) =>
  Object.fromEntries(results.tests.filter((test) => test.triage).map((test) => [test.titlePath.at(-1), test.triage!.label]));

let port: number;
let deadPort: number;

beforeAll(async () => {
  linkIntelliwright(project);
  port = await freePort();
  deadPort = await freePort();
});

describe("with the mock evaluator", () => {
  let run: CliResult;
  let results: Results;

  beforeAll(async () => {
    run = await runCli(["test"], { cwd: project, env: { ...NO_KEYS, FIXTURE_PORT: String(port), DEAD_PORT: String(deadPort) } });
    results = read();
  });

  test("each kind of failure gets the expected label", () => {
    expect(labels(results)).toEqual({
      "the cart total adds up every item": "regression",
      "checkout starts from the cart": "test_bug",
      "the slow list shows its item": "flaky",
      "the item list loads from the API": "environment",
    });
    const [cart] = results.tests;
    expect(cart!.triage).toEqual({
      label: "regression",
      probability: 0.9,
      severity: 2,
      note: "Labeled by Jev (mock) from the error, steps, logs and page.",
    });
  });

  test("the terminal, JUnit and HTML reports show the labels", () => {
    expect(run.stdout).toContain("Triage: regression (90%), severity 2.0 of 3.");
    expect(run.stdout).toMatch(/e2e\/shop\.e2e\.ts:8 › checkout starts from the cart \[test_bug\]/);

    const junit = readFileSync(path.join(project, "test-results", "junit.xml"), "utf8");
    expect(junit).toContain("Triage: environment (90%)");

    const html = readFileSync(path.join(project, "intelliwright-report", "index.html"), "utf8");
    const data = JSON.parse(/<script type="application\/json" id="report-data">(.*?)<\/script>/s.exec(html)![1]!);
    expect(data.tests.map((test: { triage?: { label: string } }) => test.triage?.label)).toEqual([
      "regression",
      "test_bug",
      "flaky",
      "environment",
      undefined,
    ]);
  });
});

test("a stopped app server is labeled environment without asking Jev", async () => {
  await runCli(["test", "--base-url", `http://127.0.0.1:${deadPort}`, "--grep", "goes to the shop"], {
    cwd: project,
    env: { ...NO_KEYS, NO_PROVIDER: "1" },
  });
  const results = read();
  expect(results.tests[0]!.triage).toEqual({
    label: "environment",
    note: "The app couldn't be reached (net::ERR_CONNECTION_REFUSED).",
  });
  expect(results.notes).toEqual([]);
});

test("without a provider, triage is skipped with a note", async () => {
  const run = await runCli(["test", "--grep", "cart total"], {
    cwd: project,
    env: { ...NO_KEYS, NO_PROVIDER: "1", FIXTURE_PORT: String(port) },
  });
  const results = read();
  expect(results.tests[0]!.triage).toBeUndefined();
  expect(results.notes).toEqual(["Triage was skipped because no Jev provider is configured."]);
  expect(run.stdout).toContain("Triage was skipped because no Jev provider is configured.");
});

test("a test that passes on a retry is labeled flaky", async () => {
  const basic = path.join(projectsDir, "basic");
  linkIntelliwright(basic);
  await runCli(["test", "--reporter", "json", "e2e/flaky.e2e.ts"], { cwd: basic, env: { ...NO_KEYS, FIXTURE_PORT: String(await freePort()) } });
  const results = JSON.parse(readFileSync(path.join(basic, "test-results", "results.json"), "utf8")) as Results;
  expect(results.tests[0]!.outcome).toBe("flaky");
  expect(results.tests[0]!.triage).toEqual({ label: "flaky", note: "Failed, then passed on retry 1." });
});
