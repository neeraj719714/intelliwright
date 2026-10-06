import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { toPosix } from "../../runner/location.js";
import type { Annotation, AttemptAi, AttemptResult, SerializedError, StepResult } from "../../runner/types.js";
import { VERSION } from "../../version.js";
import { stripAnsi } from "../format.js";
import type { AiRunSummary, Counts, Outcome, RunSummary, TestCase, TriageResult } from "../types.js";

export interface ReportAttachment {
  name: string;
  contentType: string;
  /** Relative to the report folder, such as `data/1a2b3c.png`. In UI mode, a URL on the UI server. */
  path?: string;
  /** Text content, embedded so the report shows it offline. */
  body?: string;
}

export interface ReportAttempt {
  retry: number;
  status: string;
  startTime: number;
  duration: number;
  errors: SerializedError[];
  steps: StepResult[];
  annotations: Annotation[];
  attachments: ReportAttachment[];
  ai?: AttemptAi;
}

export interface ReportTest {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  tags: string[];
  /** UI mode also shows `queued` and `running`. */
  outcome: Outcome | "notRun" | "queued" | "running";
  duration: number;
  triage?: TriageResult;
  attempts: ReportAttempt[];
}

export interface ReportData {
  version: string;
  generatedAt: string;
  /** UI mode also shows `ready`, before its first run, and `running`. */
  status: RunSummary["status"] | "ready" | "running";
  startTime: number;
  duration: number;
  counts: Counts;
  errors: SerializedError[];
  ai?: AiRunSummary;
  notes: string[];
  tests: ReportTest[];
}

/** Turns a saved file into the path or URL the page loads it from, or `undefined` when it can't. */
export type LinkFile = (file: string) => string | undefined;

const MAX_INLINE_TEXT = 200_000;

/** Copies attachments into `<folder>/data` and returns the data the report app renders. */
export function buildReportData(summary: RunSummary, folder: string, rootDir: string): ReportData {
  const dataDir = path.join(folder, "data");
  const copied = new Map<string, string>();

  const copy = (file: string): string | undefined => {
    if (!existsSync(file)) return undefined;
    const known = copied.get(file);
    if (known) return known;
    const hash = createHash("sha1").update(file).update(String(statSync(file).size)).digest("hex").slice(0, 16);
    const name = `data/${hash}${path.extname(file)}`;
    mkdirSync(dataDir, { recursive: true });
    copyFileSync(file, path.join(folder, name));
    copied.set(file, name);
    return name;
  };

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    status: summary.status,
    startTime: summary.startTime,
    duration: summary.duration,
    counts: summary.counts,
    errors: summary.errors.map((error) => cleanError(error, rootDir)),
    ai: summary.ai,
    notes: summary.notes,
    tests: summary.tests.map((test) => reportTest(test, rootDir, copy)),
  };
}

export function reportTest(test: TestCase, rootDir: string, link: LinkFile): ReportTest {
  return {
    id: test.id,
    title: test.title,
    titlePath: test.titlePath,
    file: test.relFile,
    line: test.line,
    tags: test.tags,
    outcome: test.outcome ?? "notRun",
    duration: test.results.at(-1)?.duration ?? 0,
    triage: test.triage,
    attempts: test.results.map((result) => reportAttempt(result, rootDir, link)),
  };
}

export function reportAttempt(result: AttemptResult, rootDir: string, link: LinkFile): ReportAttempt {
  return {
    retry: result.retry,
    status: result.status,
    startTime: result.startTime,
    duration: result.duration,
    errors: result.errors.map((error) => cleanError(error, rootDir)),
    steps: result.steps.map((step) => reportStep(step, rootDir)),
    annotations: result.annotations,
    ai: result.ai,
    attachments: result.attachments.map((attachment) => {
      const entry: ReportAttachment = { name: attachment.name, contentType: attachment.contentType, body: attachment.body };
      if (attachment.path) {
        entry.path = link(attachment.path);
        const isText = attachment.contentType.startsWith("text/") || attachment.contentType === "application/json";
        if (isText && existsSync(attachment.path) && statSync(attachment.path).size <= MAX_INLINE_TEXT) {
          entry.body = readFileSync(attachment.path, "utf8");
        }
      }
      return entry;
    }),
  };
}

export function reportStep(step: StepResult, rootDir: string): StepResult {
  return step.error ? { ...step, error: cleanError(step.error, rootDir) } : step;
}

/** Without terminal colors, and with the location relative to the project. */
export function cleanError(error: SerializedError, rootDir: string): SerializedError {
  return {
    ...error,
    message: stripAnsi(error.message),
    stack: error.stack ? stripAnsi(error.stack) : undefined,
    location: error.location
      ? { ...error.location, file: toPosix(path.relative(rootDir, error.location.file)) || error.location.file }
      : undefined,
  };
}
