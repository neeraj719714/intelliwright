import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { TestCase } from "../../src/reporters/types.js";
import { mergeLastRun, selectTests, writeLastRun, type SelectionOptions } from "../../src/runner/select.js";

const root = path.resolve("/project");

function testCase(relFile: string, line: number, titlePath: string[], tags: string[] = [], extra: Partial<TestCase> = {}): TestCase {
  return {
    id: `${relFile} › ${titlePath.join(" › ")}`,
    title: titlePath.at(-1)!,
    titlePath,
    file: path.join(root, relFile),
    relFile,
    line,
    column: 3,
    describeLines: [],
    tags,
    skipped: false,
    skipReason: undefined,
    only: false,
    annotations: [],
    results: [],
    outcome: undefined,
    ...extra,
  };
}

const tests = [
  testCase("e2e/auth.e2e.ts", 4, ["auth", "signs in"], ["@auth", "@smoke"], { describeLines: [3] }),
  testCase("e2e/auth.e2e.ts", 6, ["auth", "rejects a bad password"], ["@auth", "@regression"], { describeLines: [3] }),
  testCase("e2e/billing.e2e.ts", 9, ["refunds a payment"]),
  testCase("e2e/nested/search.e2e.ts", 3, ["searches @smoke"], ["@smoke"]),
];

const outputDir = mkdtempSync(path.join(tmpdir(), "intelliwright-select-"));
const select = (options: SelectionOptions) =>
  selectTests(tests, options, { cwd: root, suites: { smoke: "@smoke", nightly: "@smoke or @regression" }, outputDir }).tests.map(
    (test) => test.title,
  );

describe("selectTests", () => {
  test("file and folder filters by substring when the path doesn't exist", () => {
    expect(select({ filters: ["e2e/nested"] })).toEqual(["searches @smoke"]);
    expect(select({ filters: ["billing"] })).toEqual(["refunds a payment"]);
    expect(select({ filters: ["billing", "search"] })).toEqual(["refunds a payment", "searches @smoke"]);
  });

  test("file:line picks a test, or every test in a describe", () => {
    expect(select({ filters: ["e2e/auth.e2e.ts:6"] })).toEqual(["rejects a bad password"]);
    expect(select({ filters: ["e2e/auth.e2e.ts:3"] })).toEqual(["signs in", "rejects a bad password"]);
    expect(select({ filters: ["e2e/auth.e2e.ts:99"] })).toEqual([]);
  });

  test("tags, suites and grep combine", () => {
    expect(select({ tag: "@smoke and not @auth" })).toEqual(["searches @smoke"]);
    expect(select({ suite: "nightly" })).toEqual(["signs in", "rejects a bad password", "searches @smoke"]);
    expect(select({ suite: "smoke", tag: "@auth" })).toEqual(["signs in"]);
    expect(select({ grep: "signs|search" })).toEqual(["signs in", "searches @smoke"]);
    expect(select({ grep: "@regression" })).toEqual(["rejects a bad password"]);
    expect(select({ grepInvert: "auth" })).toEqual(["refunds a payment", "searches @smoke"]);
  });

  test("names the suites when one is unknown", () => {
    expect(() => select({ suite: "nope" })).toThrow('There is no suite named "nope". Suites in the config: smoke, nightly.');
  });

  test("rejects an invalid regular expression", () => {
    expect(() => select({ grep: "(" })).toThrow(/--grep "\(" is not a valid regular expression/);
  });

  test("--last-failed picks the failures of the last run", () => {
    writeLastRun(outputDir, { status: "failed", failedTests: [tests[2]!.id] });
    expect(select({ lastFailed: true })).toEqual(["refunds a payment"]);
    writeLastRun(outputDir, { status: "passed", failedTests: [] });
    const result = selectTests(tests, { lastFailed: true }, { cwd: root, suites: {}, outputDir });
    expect(result).toEqual({ tests: [], note: "No tests failed in the last run." });
  });

  test("--last-failed can use a last run the caller read earlier", () => {
    writeLastRun(outputDir, { status: "passed", failedTests: [] });
    const context = { cwd: root, suites: {}, outputDir };
    const earlier = { status: "failed" as const, failedTests: [tests[0]!.id] };
    expect(selectTests(tests, { lastFailed: true }, { ...context, lastRun: earlier }).tests.map((test) => test.title)).toEqual(["signs in"]);
    expect(selectTests(tests, { lastFailed: true }, { ...context, lastRun: null }).note).toMatch(/^There is no previous run in /);
  });

  test(".only focuses within the selection", () => {
    const focused = [...tests.slice(0, 3), { ...tests[3]!, only: true }];
    const result = selectTests(focused, {}, { cwd: root, suites: {}, outputDir });
    expect(result.tests.map((test) => test.title)).toEqual(["searches @smoke"]);
  });
});

describe("mergeLastRun", () => {
  test("tests the run finished take their new result, and other failures stay", () => {
    const previous = { status: "failed" as const, failedTests: ["a", "b"] };
    expect(mergeLastRun(previous, { status: "failed", finished: ["a", "c"], failedTests: ["c"] })).toEqual({
      status: "failed",
      failedTests: ["b", "c"],
    });
  });

  test("a passing run still counts as failed while earlier failures remain", () => {
    expect(mergeLastRun({ status: "failed", failedTests: ["b"] }, { status: "passed", finished: ["a"], failedTests: [] })).toEqual({
      status: "failed",
      failedTests: ["b"],
    });
    expect(mergeLastRun({ status: "failed", failedTests: ["a"] }, { status: "passed", finished: ["a"], failedTests: [] })).toEqual({
      status: "passed",
      failedTests: [],
    });
  });

  test("works without a previous run", () => {
    expect(mergeLastRun(undefined, { status: "interrupted", finished: ["a"], failedTests: ["a"] })).toEqual({
      status: "interrupted",
      failedTests: ["a"],
    });
  });
});
