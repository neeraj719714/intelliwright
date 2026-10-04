import type { Browser, BrowserContext, Page } from "playwright-core";
import type { Ai } from "../ai/fixture.js";
import type { AiDecision } from "../ai/runtime.js";
import type { UsageTotals } from "../ai/usage.js";
import type { TriageResult } from "../reporters/types.js";

/** Jev's part in one attempt. */
export interface AttemptAi {
  provider: string;
  usage: UsageTotals;
  decisions: AiDecision[];
}

export interface Location {
  file: string;
  line: number;
  column: number;
}

export interface Annotation {
  type: string;
  description?: string;
}

export interface TestDetails {
  /** Tags such as `@smoke`. Tests inherit the tags of their `describe` blocks. */
  tag?: string | string[];
  annotation?: Annotation | Annotation[];
}

export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  /** Where the error happened in the test or page object code. */
  location?: Location;
}

export type TestStatus = "passed" | "failed" | "timedOut" | "skipped" | "interrupted";

export type StepCategory = "hook" | "fixture" | "step" | "expect" | "ai";

export interface StepResult {
  title: string;
  category: StepCategory;
  startTime: number;
  duration: number;
  depth: number;
  location?: Location;
  error?: SerializedError;
}

export interface Attachment {
  name: string;
  contentType: string;
  /** Absolute path of a file saved for this attachment. */
  path?: string;
  /** Text content, for small attachments. */
  body?: string;
}

export interface AttemptResult {
  retry: number;
  workerIndex: number;
  status: TestStatus;
  startTime: number;
  duration: number;
  errors: SerializedError[];
  steps: StepResult[];
  annotations: Annotation[];
  attachments: Attachment[];
  /** The attempt's folder, when it saved any files. */
  outputDir?: string;
  /** Present when the attempt used Jev. */
  ai?: AttemptAi;
  /** Why the final failed attempt failed. */
  triage?: TriageResult;
  /** Why triage didn't run, such as no Jev provider. */
  triageSkipped?: string;
}

export interface TestInfo {
  readonly title: string;
  /** Describe titles and the test title. */
  readonly titlePath: readonly string[];
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly tags: readonly string[];
  /** 0 on the first attempt, 1 on the first retry, and so on. */
  readonly retry: number;
  readonly workerIndex: number;
  /** A folder for this attempt's files, created on first use. */
  readonly outputDir: string;
  readonly annotations: Annotation[];
  readonly attachments: Attachment[];
  /** Aborted when the test times out. */
  readonly signal: AbortSignal;
  /** Milliseconds for this test. */
  readonly timeout: number;
  /** Set once the test body and hooks finish, so fixture teardown can tell how it went. */
  readonly status: TestStatus | undefined;
  setTimeout(timeout: number): void;
  /** Skips the rest of the test when `condition` is true or omitted. */
  skip(condition?: boolean, description?: string): void;
  outputPath(...segments: string[]): string;
  attach(name: string, options: { path?: string; body?: string | Uint8Array; contentType?: string }): Promise<void>;
}

export interface WorkerInfo {
  readonly workerIndex: number;
}

export interface WorkerFixtures {
  browser: Browser;
  browserName: string;
}

export interface TestFixtures {
  context: BrowserContext;
  page: Page;
  baseURL: string | undefined;
  /** Jev-powered checks and actions on `page`. */
  ai: Ai;
}

export type BuiltinFixtures = WorkerFixtures & TestFixtures;
