import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const project = path.join(projectsDir, "run");
const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-run-"));
const codeFile = path.join(scratch, "code.ts");
const replayFile = path.join(project, "e2e", "replay.e2e.ts");
let port: number;

interface Result {
  titlePath: string[];
  outcome: string;
  attempts: Array<{
    errors: Array<{ message: string }>;
    attachments: Array<{ name: string; body?: string }>;
    steps: Array<{ title: string; category: string }>;
    ai?: { usage: { calls: number } };
  }>;
}
let tests: Result[];
const byTitle = (title: string): Result => tests.find((test) => test.titlePath.at(-1) === title)!;

beforeAll(async () => {
  linkIntelliwright(project);
  port = await freePort();
  await runCli(["test", "--reporter", "json"], { cwd: project, env: { FIXTURE_PORT: String(port), CODE_OUT: codeFile } });
  tests = (JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as { tests: Result[] }).tests;
});

afterAll(() => {
  rmSync(replayFile, { force: true });
  rmSync(scratch, { recursive: true, force: true });
});

test("a multi-step flow completes within maxSteps, using data for text fields and skipping avoided elements", () => {
  const result = byTitle("ai.run completes a multi-step signup");
  expect(result.outcome).toBe("passed");
  const attempt = result.attempts[0]!;
  const actions = attempt.steps.filter((step) => step.category === "ai" && /^step \d+:/.test(step.title)).map((step) => step.title);
  expect(actions).toEqual([
    'step 1: click button "Get started" in main',
    'step 2: fill textbox "Full name" (empty) in main',
    'step 3: fill textbox "Email" (empty) in main',
    'step 4: click button "Continue" in main',
    'step 5: click radio "Pro" (not checked) in group "Plan"',
    'step 6: click button "Create account" in main',
  ]);
  expect(actions.some((title) => title.includes("Delete account"))).toBe(false);
  const code = attempt.attachments.find((attachment) => attachment.name === "ai.run: create an account on the Pro plan")?.body;
  expect(code).toContain("await page.getByRole('textbox', { name: 'Full name', exact: true }).fill(data.name);");
});

test("a flow with no way forward stops at stuck instead of looping", () => {
  expect(byTitle("ai.run stops at stuck on a dead end instead of looping").outcome).toBe("passed");
  const failed = byTitle("a run that can't reach its goal fails the test with its steps");
  expect(failed.outcome).toBe("failed");
  expect(failed.attempts[0]!.errors[0]!.message).toBe(
    'ai.run("finish the signup") stopped without reaching the goal (stuck after 1 step).\n' +
      'button "Try again" in main was chosen again, but using it last time changed nothing.\n' +
      "Steps:\n" +
      '  1. click button "Try again" in main',
  );
});

test("the run never leaves the base URL's origin", () => {
  expect(byTitle("ai.run never leaves the base URL's origin").outcome).toBe("passed");
  expect(byTitle("ai.run asks for data it doesn't have").outcome).toBe("passed");
});

test("the printed code replays the same flow", async () => {
  const code = readFileSync(codeFile, "utf8");
  writeFileSync(
    replayFile,
    [
      'import { expect, test } from "intelliwright";',
      "",
      'test("replay of the ai.run code", async ({ page }) => {',
      '  const data = { name: "Jane Doe", email: "jane@example.com" };',
      '  await page.goto("/signup/");',
      ...code.split("\n").map((line) => `  ${line}`),
      '  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome aboard, Jane Doe!");',
      '  await expect(page.getByText("You are on the Pro plan.")).toBeVisible();',
      "});",
      "",
    ].join("\n"),
  );
  const run = await runCli(["test", "--reporter", "json", "--grep", "replay"], { cwd: project, env: { FIXTURE_PORT: String(port) } });
  const [replay] = (JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as { tests: Result[] }).tests;
  expect(replay!.attempts[0]!.errors).toEqual([]);
  expect(replay!.outcome).toBe("passed");
  expect(replay!.attempts[0]!.ai).toBeUndefined();
  expect(run.code).toBe(0);
});
