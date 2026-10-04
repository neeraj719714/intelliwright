import type { Page } from "playwright-core";
import type { TriageResult } from "../reporters/types.js";
import { stripAnsi } from "../reporters/format.js";
import type { NetworkEntry } from "../runner/artifacts.js";
import type { SerializedError, StepResult } from "../runner/types.js";
import { capturePageState } from "./page-state.js";
import type { Jev } from "./providers/resolve.js";
import { redactJson } from "./redact.js";
import type { AiDecision } from "./runtime.js";
import type { ChoiceQuestion, JsonValue, ScoreQuestion } from "./types.js";

export interface TriageEvidence {
  titlePath: readonly string[];
  errors: SerializedError[];
  steps: StepResult[];
  console: string[];
  network: NetworkEntry[];
  page: Page | undefined;
  baseURL: string | undefined;
}

const CONNECTION_FAILURES = /net::ERR_CONNECTION_(?:REFUSED|RESET|CLOSED)|ECONNREFUSED|ECONNRESET|net::ERR_NAME_NOT_RESOLVED|ENOTFOUND/;

const CAUSE: ChoiceQuestion = {
  type: "choice",
  instructions: "What most likely caused this end-to-end test failure?",
  criteria: {
    regression: "A bug in the app: it behaves differently from what the test expects, and the test is right",
    test_bug: "A mistake in the test: a wrong locator, a wrong expected value, or a wrong assumption about the app",
    flaky: "Timing: the page wasn't ready yet, or a slow response or animation got in the way, and a retry could pass",
    environment: "The environment: a server or service is down or unreachable, a network or third-party failure, or missing configuration",
  },
};

const SEVERITY: ScoreQuestion = {
  type: "score",
  instructions: "How badly would this failure affect people using the app, if it is a real bug?",
  criteria: ["Cosmetic: nothing is blocked", "Minor: there is a workaround", "Major: a feature is broken", "Blocking: people can't continue"],
};

/** Labels that need no Jev call: a refused connection to the app is the environment. */
export function ruleTriage(errors: SerializedError[], baseURL: string | undefined): TriageResult | undefined {
  const message = errors.map((error) => error.message).join("\n");
  const match = CONNECTION_FAILURES.exec(message);
  if (!match) return undefined;
  const origin = baseURL ? safeOrigin(baseURL) : undefined;
  if (origin && !message.includes(origin) && !message.includes(origin.replace("127.0.0.1", "localhost"))) {
    return undefined;
  }
  return { label: "environment", note: `The app couldn't be reached (${match[0]}).` };
}

/**
 * Asks Jev for the cause and severity of a failure, from the error, the last
 * steps, console errors, failed requests and the page as it was. Returns the
 * label and the decision for the report.
 */
export async function askJevForTriage(
  evidence: TriageEvidence,
  jev: Jev,
  redact: ReadonlyArray<RegExp | string>,
): Promise<{ triage: TriageResult; decision: AiDecision }> {
  const startTime = Date.now();
  const patterns = redact.filter((item): item is RegExp => item instanceof RegExp);
  const [first] = evidence.errors;
  const facts: Record<string, JsonValue> = {
    test: evidence.titlePath.join(" › "),
    error: truncate(stripAnsi(first?.message ?? "unknown error"), 2_000),
    stack: (first?.stack ?? "").split("\n").filter((line) => line.trim().startsWith("at ")).slice(0, 6).map((line) => line.trim()),
    lastSteps: evidence.steps.slice(-6).map((step) => `${step.category}: ${step.title}${step.error ? ` (failed: ${truncate(stripAnsi(step.error.message), 200)})` : ""}`),
    consoleErrors: evidence.console.filter((line) => /^\[(error|pageerror)\]/.test(line)).slice(-10),
    failedRequests: evidence.network
      .filter((entry) => entry.failure || (entry.status !== undefined && entry.status >= 400))
      .slice(-10)
      .map((entry) => `${entry.method} ${entry.url} -> ${entry.failure ?? entry.status}`),
  };
  if (evidence.page && !evidence.page.isClosed()) {
    try {
      const { state } = await capturePageState(evidence.page, { budget: jev.budget, redact, questionTokens: 6_000, timeout: 3_000 });
      facts.page = state;
    } catch {}
  }

  const state = redactJson(facts, { patterns });
  const result = await jev.evaluator.evaluate(
    { state, questions: { cause: CAUSE, severity: SEVERITY } },
    { signal: AbortSignal.timeout(30_000) },
  );
  const { cause, severity } = result.answers;
  const probability = cause.probabilities[cause.choice];
  return {
    triage: {
      label: cause.choice,
      probability,
      severity: severity.score,
      note: `Labeled by Jev (${jev.provider}) from the error, steps, logs and page.`,
    },
    decision: {
      kind: "triage",
      question: "What caused this failure?",
      answer: cause.choice,
      probability,
      confidence: cause.confidence,
      model: result.model,
      startTime,
      durationMs: Date.now() - startTime,
    },
  };
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
