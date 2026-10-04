import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import { linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const project = path.join(projectsDir, "matchers");

interface Result {
  titlePath: string[];
  tags: string[];
  outcome: string;
  attempts: Array<{ errors: Array<{ message: string }>; steps: Array<{ title: string; category: string; error?: unknown }> }>;
}
let tests: Result[];

beforeAll(async () => {
  linkIntelliwright(project);
  await runCli(["test"], { cwd: project });
  tests = (JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as { tests: Result[] }).tests;
});

const byTitle = (title: string): Result => tests.find((test) => test.titlePath.at(-1) === title)!;

test("page matchers retry until they pass, including .not", () => {
  const passing = tests.filter((test) => !test.tags.includes("@expected-failure"));
  expect(passing.map((test) => [test.titlePath.at(-1), test.outcome])).toEqual(passing.map((test) => [test.titlePath.at(-1), "passed"]));
  expect(passing).toHaveLength(6);
});

test("a matcher that never passes explains what it looked for", () => {
  const result = byTitle("fails clearly when an element never appears");
  expect(result.outcome).toBe("failed");
  const message = result.attempts[0]!.errors[0]!.message;
  expect(message).toContain("expect(locator).toBeVisible()");
  expect(message).toContain("Locator: getByRole('button', { name: 'Missing' })");
  expect(message).toContain("Expected: visible");
  expect(message).toContain("Received: not found");
  expect(message).toContain("Timed out after 300ms.");
});

test("a strict mode violation fails at once", () => {
  const message = byTitle("fails on a strict mode violation").attempts[0]!.errors[0]!.message;
  expect(message).toContain("strict mode violation: the locator matches 2 elements");
  expect(message).not.toContain("Timed out");
});

test("text mismatches show both values", () => {
  const message = byTitle("fails when text never matches").attempts[0]!.errors[0]!.message;
  expect(message).toContain('Expected string: "Goodbye"');
  expect(message).toContain('Received: "Welcome"');
});

test("each matcher is a step in the report", () => {
  const steps = byTitle("toHaveURL and toHaveTitle").attempts[0]!.steps.filter((step) => step.category === "expect");
  expect(steps.map((step) => step.title)).toEqual(["expect.toHaveURL()", "expect.toHaveTitle()", "expect.toHaveURL()"]);
  const failed = byTitle("fails when text never matches").attempts[0]!.steps.find((step) => step.category === "expect");
  expect(failed?.error).toBeDefined();
});
