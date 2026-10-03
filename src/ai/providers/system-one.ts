import { postJson } from "../http.js";
import { estimateCostUsd } from "../pricing.js";
import type {
  Evaluator,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResult,
  JsonValue,
  Questions,
  TokenBudget,
  Usage,
} from "../types.js";
import { isRecord, validateAnswers } from "../validate.js";

/** One provider connection. Every request it makes is a single HTTP call. */
export interface ProviderClient extends Evaluator {
  /** Shown in errors and reports, such as "TypeSafe". */
  readonly name: string;
  /** The model asked for, such as `jev-latest`. */
  readonly model: string;
  readonly budget: TokenBudget;
}

export interface HttpClientOptions {
  fetch?: typeof fetch;
  /** Per attempt, in milliseconds. */
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export interface SystemOneOptions extends HttpClientOptions {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  keyHint?: string;
  budget: TokenBudget;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * TypeSafe's System One API, which TypeSafe, Vercel AI Gateway and OpenRouter
 * all serve: `POST {baseURL}/v1/systemone` with `{ model, state, questions }`.
 */
export function createSystemOneClient(options: SystemOneOptions): ProviderClient {
  const url = `${options.baseURL.replace(/\/+$/, "")}/v1/systemone`;
  return {
    name: options.name,
    model: options.model,
    budget: options.budget,
    async evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      evaluateOptions?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      const { json } = await postJson({
        provider: options.name,
        url,
        apiKey: options.apiKey,
        keyHint: options.keyHint,
        body: {
          model: options.model,
          state: request.state,
          questions: toWireQuestions(request.questions),
        },
        headers: options.headers,
        fetch: options.fetch ?? fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
        retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
        signal: evaluateOptions?.signal,
      });
      return parseSystemOneResponse(json, request.questions, options.name, options.model);
    },
  };
}

/** Intelliwright's `boolean` is TypeSafe's `noul`. */
export function toWireQuestions(questions: Questions): Record<string, JsonValue> {
  const wire: Record<string, JsonValue> = {};
  for (const [key, question] of Object.entries(questions)) {
    const entry: Record<string, JsonValue> = {
      type: question.type === "boolean" ? "noul" : question.type,
      instructions: question.instructions,
    };
    if (question.criteria !== undefined) {
      entry.criteria = question.criteria as JsonValue;
    }
    wire[key] = entry;
  }
  return wire;
}

/** Converts a System One response into Intelliwright's answer types. */
export function parseSystemOneResponse<Qs extends Questions>(
  json: unknown,
  questions: Qs,
  provider: string,
  requestedModel: string,
): EvaluateResult<Qs> {
  const body = isRecord(json) ? json : {};
  const rawAnswers = isRecord(body.answers) ? body.answers : undefined;
  const converted: Record<string, unknown> = {};
  if (rawAnswers) {
    for (const [key, answer] of Object.entries(rawAnswers)) {
      converted[key] = fromWireAnswer(answer);
    }
  }
  const answers = validateAnswers(questions, rawAnswers ? converted : undefined, provider);

  const model = typeof body.model === "string" && body.model ? body.model : requestedModel;
  const usage = readUsage(body.usage);
  const reportedCost = readReportedCost(body);
  return {
    answers,
    model,
    usage,
    costUsd: reportedCost ?? estimateCostUsd(model, usage),
    costEstimated: reportedCost === undefined,
  };
}

function fromWireAnswer(answer: unknown): unknown {
  if (!isRecord(answer)) return answer;
  if (answer.type === "noul") {
    return { type: "boolean", probability: answer.noul ?? answer.probability };
  }
  return answer;
}

function readUsage(raw: unknown): Usage {
  if (!isRecord(raw)) return { inputTokens: 0, outputTokens: 0 };
  const input = raw.input_tokens ?? raw.inputTokens ?? raw.prompt_tokens;
  const output = raw.output_tokens ?? raw.outputTokens ?? raw.completion_tokens;
  return {
    inputTokens: typeof input === "number" ? input : 0,
    outputTokens: typeof output === "number" ? output : 0,
  };
}

function readReportedCost(body: Record<string, unknown>): number | undefined {
  const usage = isRecord(body.usage) ? body.usage : {};
  for (const value of [usage.cost, usage.cost_usd, body.cost]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}
