import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const project = path.join(projectsDir, "actions");
let port: number;

interface Results {
  tests: Array<{
    outcome: string;
    attempts: Array<{
      errors: Array<{ message: string }>;
      steps: Array<{ title: string; category: string }>;
      ai?: { usage: { calls: number }; decisions: Array<{ kind: string; question: string; answer: string; probability?: number }> };
    }>;
  }>;
}

async function run(args: string[] = [], env: Record<string, string> = {}): Promise<Results["tests"][number]> {
  await runCli(["test", "--reporter", "json", "--grep", "intended elements", ...args], {
    cwd: project,
    env: { FIXTURE_PORT: String(port), ...env },
  });
  return (JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as Results).tests[0]!;
}

const notes = (result: Results["tests"][number]): string[] =>
  result.attempts.at(-1)!.steps.filter((step) => step.category === "ai" && /^(cached locator|chose):/.test(step.title)).map((step) => step.title);

beforeAll(async () => {
  linkIntelliwright(project);
  port = await freePort();
  rmSync(path.join(project, ".intelliwright"), { recursive: true, force: true });
});

test("each action reaches the intended element, and the choices are cached", async () => {
  const first = await run();
  expect(first.outcome).toBe("passed");
  expect(first.attempts[0]!.ai!.usage.calls).toBe(6);
  expect(notes(first)).toEqual([
    "chose: page.getByRole('button', { name: 'Sign in', exact: true })",
    "chose: page.getByRole('textbox', { name: 'Email address', exact: true })",
    "chose: page.getByRole('combobox', { name: 'Plan', exact: true })",
    "chose: page.getByRole('checkbox', { name: 'I agree to the terms', exact: true })",
    "chose: page.getByRole('button', { name: 'More options', exact: true })",
    "chose: page.getByRole('button', { name: 'Subscribe', exact: true })",
  ]);
  expect(first.attempts[0]!.ai!.decisions[0]).toMatchObject({
    kind: "action",
    question: "click: the Sign in button in the header",
    answer: 'button "Sign in" in banner',
    probability: 0.9,
  });

  const cache = JSON.parse(readFileSync(path.join(project, ".intelliwright", "cache.json"), "utf8"));
  expect(cache.entries["/actions.html click the Sign in button in the header"].locator).toEqual({
    kind: "role",
    role: "button",
    name: "Sign in",
  });
});

test("a second run uses the cache and makes no Jev calls", async () => {
  const second = await run();
  expect(second.outcome).toBe("passed");
  expect(second.attempts[0]!.ai).toBeUndefined();
  expect(notes(second).every((note) => note.startsWith("cached locator:"))).toBe(true);
  expect(notes(second)).toHaveLength(6);
});

test("after the button's text changes, its cached locator is resolved again", async () => {
  const changed = await run([], { BUTTON_LABEL: "Join" });
  expect(changed.outcome).toBe("passed");
  expect(changed.attempts[0]!.ai!.usage.calls).toBe(1);
  expect(notes(changed).at(-1)).toBe("chose: page.getByRole('button', { name: 'Join', exact: true })");
  const cache = JSON.parse(readFileSync(path.join(project, ".intelliwright", "cache.json"), "utf8"));
  expect(cache.entries["/actions.html locate the button that submits the newsletter form"].locator.name).toBe("Join");
});

test("--update-cache resolves every action again", async () => {
  const updated = await run(["--update-cache"]);
  expect(updated.outcome).toBe("passed");
  expect(updated.attempts[0]!.ai!.usage.calls).toBe(6);
});

test("an action with no fitting element fails and lists the best candidates", async () => {
  await runCli(["test", "--reporter", "json", "--grep", "no matching element"], { cwd: project, env: { FIXTURE_PORT: String(port) } });
  const [result] = (JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as Results).tests;
  expect(result!.outcome).toBe("failed");
  const message = result!.attempts[0]!.errors[0]!.message;
  expect(message).toContain('ai.click("the shopping cart icon") found no matching element.');
  expect(message).toMatch(/Best matches:\n {2}0\.90 {2}No element on the page matches\n/);
  expect(message).toContain("Describe the element more precisely, or use a fixed locator in the page object.");
});
