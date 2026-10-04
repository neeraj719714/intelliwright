import type { UsageTotals } from "../ai/usage.js";
import type { ResolvedConfig } from "../config/types.js";
import type { Annotation, AttemptResult, SerializedError, StepResult } from "../runner/types.js";

/** Jev usage for the whole run. */
export interface AiRunSummary {
  provider: string;
  usage: UsageTotals;
}

export type Outcome = "passed" | "failed" | "flaky" | "skipped";

/** Why a test failed, from rules or from Jev. */
export interface TriageResult {
  /** `regression`, `test_bug`, `flaky` or `environment`. */
  label: string;
  /** How sure Jev was, when Jev chose the label. */
  probability?: number;
  /** Jev's severity score, from 0 (cosmetic) to 3 (blocking). */
  severity?: number;
  /** How the label was decided, or why triage was skipped. */
  note?: string;
}

/** A test as the main process sees it, with every attempt's result. */
export interface TestCase {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  /** Relative to the config folder, with forward slashes. */
  relFile: string;
  line: number;
  column: number;
  /** Lines of the describe blocks around the test, so `file:line` can pick a whole describe. */
  describeLines: number[];
  tags: string[];
  skipped: boolean;
  skipReason: string | undefined;
  /** Marked with `.only`, directly or through a describe. */
  only: boolean;
  annotations: Annotation[];
  results: AttemptResult[];
  /** Set once the test's last attempt has ended. */
  outcome: Outcome | undefined;
  triage?: TriageResult;
  /** The role whose saved sign-in the test starts with. */
  auth?: string;
  /** Set on sign-in tests from `test.auth()`: the role whose state they save. */
  authSetup?: string;
}

export interface Counts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export interface RunInfo {
  config: ResolvedConfig;
  tests: TestCase[];
  workers: number;
  startTime: number;
}

export interface RunSummary {
  status: "passed" | "failed" | "interrupted";
  startTime: number;
  duration: number;
  tests: TestCase[];
  /** Errors outside tests, such as a test file that failed to load. */
  errors: SerializedError[];
  counts: Counts;
  ai?: AiRunSummary;
  /** Things the reader should know, such as triage being skipped. */
  notes: string[];
}

export interface Reporter {
  onBegin?(run: RunInfo): void;
  onTestBegin?(test: TestCase, retry: number): void;
  onStepEnd?(test: TestCase, retry: number, step: StepResult): void;
  onTestEnd?(test: TestCase, result: AttemptResult, willRetry: boolean): void;
  onError?(error: SerializedError): void;
  onEnd?(summary: RunSummary): void | Promise<void>;
}
