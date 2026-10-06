import type { ReportAttempt, ReportData, ReportTest } from "../reporters/html/data.js";
import type { AiRunSummary, Counts, TriageResult } from "../reporters/types.js";
import type { SerializedError, StepResult } from "../runner/types.js";

/** What UI mode shows: the HTML report's data, kept current by events. Shared by the server and the page. */
export type UiState = ReportData;

export type UiEvent =
  /** The whole state: on connecting, after test files change, and as a run starts and ends. */
  | { type: "tests"; state: UiState }
  /** A run started, with the status `running`, or ended. */
  | { type: "run"; status: UiState["status"]; startTime: number; duration: number; ai?: AiRunSummary; notes: string[] }
  | { type: "testBegin"; testId: string; retry: number; startTime: number }
  | { type: "step"; testId: string; retry: number; step: StepResult }
  /** `outcome` and `triage` come with the test's last attempt. */
  | { type: "testEnd"; testId: string; attempt: ReportAttempt; outcome?: ReportTest["outcome"]; triage?: TriageResult }
  | { type: "error"; error: SerializedError };

export function applyEvent(state: UiState, event: UiEvent): UiState {
  switch (event.type) {
    case "tests":
      return event.state;
    case "run":
      return { ...state, status: event.status, startTime: event.startTime, duration: event.duration, ai: event.ai, notes: event.notes };
    case "testBegin":
      return updateTest(state, event.testId, (test) => ({
        ...test,
        outcome: "running",
        attempts: [
          ...test.attempts,
          { retry: event.retry, status: "running", startTime: event.startTime, duration: 0, errors: [], steps: [], annotations: [], attachments: [] },
        ],
      }));
    case "step":
      return updateTest(state, event.testId, (test) => ({
        ...test,
        attempts: test.attempts.map((attempt) =>
          attempt.retry === event.retry ? { ...attempt, steps: insertStep(attempt.steps, event.step) } : attempt,
        ),
      }));
    case "testEnd":
      return updateTest(state, event.testId, (test) => ({
        ...test,
        outcome: event.outcome ?? test.outcome,
        triage: event.triage ?? test.triage,
        duration: event.attempt.duration,
        attempts: [...test.attempts.filter((attempt) => attempt.retry !== event.attempt.retry), event.attempt],
      }));
    case "error":
      return { ...state, errors: [...state.errors, event.error] };
  }
}

export function countTests(tests: ReportTest[]): Counts {
  const counts: Counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const test of tests) if (test.outcome in counts) counts[test.outcome as keyof Counts]++;
  return counts;
}

function updateTest(state: UiState, id: string, change: (test: ReportTest) => ReportTest): UiState {
  if (!state.tests.some((test) => test.id === id)) return state;
  const tests = state.tests.map((test) => (test.id === id ? change(test) : test));
  return { ...state, tests, counts: countTests(tests) };
}

/** Steps arrive as they end, children before their parents, so each goes in by when it started. */
function insertStep(steps: StepResult[], step: StepResult): StepResult[] {
  let index = steps.length;
  while (index > 0 && startsAfter(steps[index - 1]!, step)) index--;
  return [...steps.slice(0, index), step, ...steps.slice(index)];
}

function startsAfter(a: StepResult, b: StepResult): boolean {
  return a.startTime > b.startTime || (a.startTime === b.startTime && a.depth > b.depth);
}
