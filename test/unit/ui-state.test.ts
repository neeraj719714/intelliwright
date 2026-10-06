import { describe, expect, test } from "vitest";
import type { ReportAttempt, ReportTest } from "../../src/reporters/html/data.js";
import type { StepResult } from "../../src/runner/types.js";
import { applyEvent, countTests, type UiState } from "../../src/ui/state.js";

const listed = (id: string, outcome: ReportTest["outcome"] = "notRun"): ReportTest => ({
  id,
  title: id,
  titlePath: [id],
  file: "e2e/a.e2e.ts",
  line: 1,
  tags: [],
  outcome,
  duration: 0,
  attempts: [],
});

const state = (tests: ReportTest[]): UiState => ({
  version: "0.0.0",
  generatedAt: "",
  status: "running",
  startTime: 1,
  duration: 0,
  counts: countTests(tests),
  errors: [],
  notes: [],
  tests,
});

const step = (title: string, startTime: number, depth: number): StepResult => ({ title, category: "step", startTime, duration: 1, depth });

const attempt = (retry: number, status: string): ReportAttempt => ({
  retry,
  status,
  startTime: 10 + retry,
  duration: 5,
  errors: [],
  steps: [],
  annotations: [],
  attachments: [],
});

describe("applyEvent", () => {
  test("a test runs, and its steps go in by when they started, parents before children", () => {
    let current = applyEvent(state([listed("a"), listed("b")]), { type: "testBegin", testId: "a", retry: 0, startTime: 10 });
    expect(current.tests[0]!.outcome).toBe("running");
    for (const item of [step("child", 11, 1), step("parent", 10, 0), step("next", 20, 0)]) {
      current = applyEvent(current, { type: "step", testId: "a", retry: 0, step: item });
    }
    expect(current.tests[0]!.attempts[0]!.steps.map((item) => item.title)).toEqual(["parent", "child", "next"]);
    expect(current.tests[1]).toEqual(listed("b"));
  });

  test("a retry keeps the test running, and the last attempt sets the outcome and counts", () => {
    let current = applyEvent(state([listed("a")]), { type: "testBegin", testId: "a", retry: 0, startTime: 10 });
    current = applyEvent(current, { type: "testEnd", testId: "a", attempt: attempt(0, "failed") });
    expect(current.tests[0]!.outcome).toBe("running");
    current = applyEvent(current, { type: "testBegin", testId: "a", retry: 1, startTime: 11 });
    current = applyEvent(current, {
      type: "testEnd",
      testId: "a",
      attempt: attempt(1, "passed"),
      outcome: "flaky",
      triage: { label: "flaky" },
    });
    expect(current.tests[0]!.attempts.map((item) => item.status)).toEqual(["failed", "passed"]);
    expect(current.tests[0]!.outcome).toBe("flaky");
    expect(current.tests[0]!.triage).toEqual({ label: "flaky" });
    expect(current.counts).toEqual({ passed: 0, failed: 0, flaky: 1, skipped: 0 });
  });

  test("events for tests that aren't listed change nothing", () => {
    const before = state([listed("a")]);
    expect(applyEvent(before, { type: "testBegin", testId: "gone", retry: 0, startTime: 10 })).toBe(before);
  });

  test("a run event sets the status and the run's numbers, and errors add up", () => {
    let current = applyEvent(state([listed("a", "passed")]), {
      type: "run",
      status: "passed",
      startTime: 5,
      duration: 900,
      notes: ["a note"],
    });
    current = applyEvent(current, { type: "error", error: { message: "afterAll hook failed" } });
    expect(current).toMatchObject({ status: "passed", startTime: 5, duration: 900, notes: ["a note"], errors: [{ message: "afterAll hook failed" }] });
  });
});
