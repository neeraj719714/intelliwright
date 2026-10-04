import type { Locator, Page } from "playwright-core";
import type { LocatorCache } from "./cache.js";
import { JevError } from "./errors.js";
import { capturePageState, type CapturedState } from "./page-state.js";
import type { Jev } from "./providers/resolve.js";
import type { Answer, EvaluateRequest, EvaluateResult, Question, Questions } from "./types.js";

/** One answer from Jev, as shown in reports. */
export interface AiDecision {
  kind: "assertion" | "action" | "run" | "evaluate";
  /** The claim, action description or question. */
  question: string;
  /** The choice, score, or `yes`/`no` for a boolean. */
  answer: string;
  probability?: number;
  confidence?: number;
  /** For assertions: whether the check passed. */
  passed?: boolean;
  model: string;
  startTime: number;
  durationMs: number;
}

export interface AiRuntimeSettings {
  minProbability: number;
  cache: boolean;
  updateCache: boolean;
  redact: ReadonlyArray<RegExp | string>;
}

export const NO_PROVIDER_MESSAGE: string =
  "No Jev provider is configured, so AI checks and actions can't run. Set TYPESAFE_API_KEY " +
  "(or AI_GATEWAY_API_KEY, OPENROUTER_API_KEY, or CLOUDFLARE_API_TOKEN with CLOUDFLARE_ACCOUNT_ID) " +
  "in .env.local, or set ai.provider in intelliwright.config.ts.";

export interface AiRuntimeOptions {
  settings: AiRuntimeSettings;
  /** Resolves the worker's provider on first use; may throw a config error. */
  jev: () => Jev | undefined;
  signal: AbortSignal;
  step: <T>(title: string, body: () => Promise<T>) => Promise<T>;
  /** Adds a finished, zero-length step, such as "used the cached locator". */
  note: (title: string) => void;
  /** Undefined when `ai.cache` is off. */
  cache: LocatorCache | undefined;
  testIdAttribute: string;
  baseURL: string | undefined;
}

/** What AI features share within one test attempt. */
export class AiRuntime {
  readonly settings: AiRuntimeSettings;
  readonly decisions: AiDecision[] = [];
  readonly signal: AbortSignal;
  readonly cache: LocatorCache | undefined;
  readonly testIdAttribute: string;
  readonly baseURL: string | undefined;
  readonly #jev: () => Jev | undefined;
  readonly #step: <T>(title: string, body: () => Promise<T>) => Promise<T>;
  readonly #note: (title: string) => void;

  constructor(options: AiRuntimeOptions) {
    this.settings = options.settings;
    this.signal = options.signal;
    this.cache = options.cache;
    this.testIdAttribute = options.testIdAttribute;
    this.baseURL = options.baseURL;
    this.#jev = options.jev;
    this.#step = options.step;
    this.#note = options.note;
  }

  note(title: string): void {
    this.#note(title);
  }

  jev(): Jev {
    const jev = this.#jev();
    if (!jev) throw new JevError(NO_PROVIDER_MESSAGE, { kind: "config", provider: "none" });
    return jev;
  }

  evaluate<Qs extends Questions>(request: EvaluateRequest<Qs>): Promise<EvaluateResult<Qs>> {
    return this.jev().evaluator.evaluate(request, { signal: this.signal });
  }

  capture(target: Page | Locator, questionTokens?: number): Promise<CapturedState> {
    return capturePageState(target, { budget: this.jev().budget, redact: this.settings.redact, questionTokens });
  }

  step<T>(title: string, body: () => Promise<T>): Promise<T> {
    return this.#step(title, body);
  }

  record(decision: AiDecision): void {
    this.decisions.push(decision);
  }
}

/** Short text for a question in reports. */
export function describeQuestion(question: Question): string {
  return typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
}

/** The answer, its probability and its confidence, for reports. */
export function describeAnswer(answer: Answer): Pick<AiDecision, "answer" | "probability" | "confidence"> {
  switch (answer.type) {
    case "boolean":
      return { answer: answer.probability >= 0.5 ? "yes" : "no", probability: answer.probability };
    case "choice":
      return {
        answer: answer.choice,
        probability: answer.probabilities[answer.choice],
        confidence: answer.confidence,
      };
    case "score":
      return { answer: answer.score.toFixed(2), confidence: answer.confidence };
  }
}
