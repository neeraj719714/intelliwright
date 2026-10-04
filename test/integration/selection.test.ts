import { rmSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const project = path.join(projectsDir, "tags");

const ALL = [
  "e2e/auth.e2e.ts:4 › auth › signs in @auth @smoke",
  "e2e/auth.e2e.ts:6 › auth › rejects a bad password @auth @regression @slow",
  "e2e/auth.e2e.ts:9 › signs out @smoke",
  "e2e/billing.e2e.ts:4 › billing › shows invoices @regression",
  "e2e/billing.e2e.ts:6 › billing › pays an invoice @slow",
  "e2e/billing.e2e.ts:9 › refunds a payment",
  "e2e/nested/search.e2e.ts:3 › searches @smoke",
  "e2e/nested/search.e2e.ts:5 › filters results @regression",
];

async function list(...args: string[]): Promise<string[]> {
  const run = await runCli(["test", "--list", ...args], { cwd: project });
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  return run.stdout
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim());
}

beforeAll(() => {
  linkIntelliwright(project);
  rmSync(path.join(project, "test-results"), { recursive: true, force: true });
});

describe("--list", () => {
  test("prints every test with its tags and a total", async () => {
    const run = await runCli(["test", "--list"], { cwd: project });
    expect(run.stdout).toBe(`Listing tests:\n${ALL.map((line) => `  ${line}`).join("\n")}\nTotal: 8 tests in 3 files\n`);
  });

  test.each([
    [["e2e/nested"], [6, 7]],
    [["e2e/auth.e2e.ts:3"], [0, 1]],
    [["e2e/auth.e2e.ts:4"], [0]],
    [["e2e/billing.e2e.ts:9", "e2e/auth.e2e.ts:9"], [2, 5]],
    [["--tag", "@smoke and not @auth"], [2, 6]],
    [["--tag", "(@regression or @slow) and not @auth"], [3, 4, 7]],
    [["--grep", "invoice"], [3, 4]],
    [["--grep-invert", "@slow"], [0, 2, 3, 5, 6, 7]],
    [["--suite", "nightly"], [0, 1, 2, 3, 6, 7]],
    [["--suite", "fast"], [0, 2, 3, 5, 6, 7]],
    [["--suite", "smoke", "--tag", "@auth"], [0]],
    [["e2e/billing.e2e.ts", "--grep", "pay"], [4, 5]],
  ])("%j", async (args, expected) => {
    expect(await list(...args)).toEqual(expected.map((index) => ALL[index]));
  });
});

test("an unknown suite or a bad tag expression is a clear error", async () => {
  const suite = await runCli(["test", "--suite", "nope"], { cwd: project });
  expect(suite.stderr).toBe('Error: There is no suite named "nope". Suites in the config: smoke, nightly, fast.\n');
  expect(suite.code).toBe(1);

  const tag = await runCli(["test", "--tag", "@smoke and"], { cwd: project });
  expect(tag.stderr).toBe('Error: Invalid tag expression "@smoke and": expected a tag at the end.\n');
  expect(tag.code).toBe(1);
});

test("--last-failed reruns only the tests that failed", async () => {
  const first = await runCli(["test"], { cwd: project, env: { FAIL_REFUNDS: "1" } });
  expect(first.stdout).toContain("7 passed");
  expect(first.stdout).toContain("1 failed");
  expect(first.code).toBe(1);

  expect(await list("--last-failed")).toEqual([ALL[5]]);

  const rerun = await runCli(["test", "--last-failed"], { cwd: project });
  expect(rerun.stdout).toContain("Running 1 test using 1 worker");
  expect(rerun.stdout).toContain("1 passed");
  expect(rerun.code).toBe(0);

  const nothing = await runCli(["test", "--last-failed"], { cwd: project });
  expect(nothing.stdout).toBe("No tests failed in the last run.\n");
  expect(nothing.code).toBe(0);
});
