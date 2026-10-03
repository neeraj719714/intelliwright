import { JevError } from "../ai/errors.js";
import {
  estimateQuestionTokens,
  estimateStateTokens,
  REQUEST_OVERHEAD_TOKENS,
} from "../ai/tokens.js";
import type {
  Answer,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResult,
  Evaluator,
  Question,
  Questions,
} from "../ai/types.js";
import { validateAnswers } from "../ai/validate.js";

/**
 * A full answer, or a shorthand: a number or boolean for a boolean question,
 * an option name for a choice, a level number for a score.
 */
export type MockAnswer = Answer | number | boolean | string;

export type MockHandler = (
  request: EvaluateRequest,
) => Record<string, MockAnswer> | Promise<Record<string, MockAnswer>>;

export interface MockEvaluatorOptions {
  /** Shown in reports. Defaults to "mock". */
  name?: string;
  /** Most input tokens one request may use. Defaults to 32,000. */
  maxInputTokens?: number;
}

export interface MockEvaluator extends Evaluator {
  readonly name: string;
  readonly maxInputTokens: number;
  /** Every request answered so far, oldest first. */
  readonly calls: readonly EvaluateRequest[];
  reset(): void;
}

/**
 * Answers questions locally, so suites that use AI features run without a key.
 * Pass it as `ai.provider`, or call it directly in unit tests.
 */
export function createMockEvaluator(
  handler: MockHandler,
  options: MockEvaluatorOptions = {},
): MockEvaluator {
  const name = options.name ?? "mock";
  const calls: EvaluateRequest[] = [];
  return {
    name,
    maxInputTokens: options.maxInputTokens ?? 32_000,
    calls,
    reset() {
      calls.length = 0;
    },
    async evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      evaluateOptions?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      evaluateOptions?.signal?.throwIfAborted();
      calls.push(request);
      const raw = await handler(request);
      const expanded: Record<string, unknown> = {};
      for (const [key, question] of Object.entries(request.questions)) {
        if (raw[key] !== undefined) expanded[key] = expand(key, question, raw[key], name);
      }
      const questions = Object.values(request.questions);
      return {
        answers: validateAnswers(request.questions, expanded, name),
        model: name,
        usage: {
          inputTokens:
            REQUEST_OVERHEAD_TOKENS +
            estimateStateTokens(request.state) +
            questions.reduce((sum, question) => sum + estimateQuestionTokens(question), 0),
          outputTokens: 20 * questions.length,
        },
        costUsd: 0,
        costEstimated: false,
      };
    },
  };
}

function expand(key: string, question: Question, value: MockAnswer, name: string): unknown {
  if (typeof value === "object" && value !== null) return value;
  switch (question.type) {
    case "boolean":
      if (typeof value === "boolean") return { type: "boolean", probability: value ? 1 : 0 };
      if (typeof value === "number") return { type: "boolean", probability: value };
      break;
    case "choice":
      if (typeof value === "string") {
        const probabilities: Record<string, number> = {};
        for (const option of Object.keys(question.criteria)) probabilities[option] = option === value ? 1 : 0;
        return { type: "choice", choice: value, probabilities, confidence: 1 };
      }
      break;
    case "score":
      if (typeof value === "number") {
        const level = Math.round(value);
        return {
          type: "score",
          score: value,
          probabilities: question.criteria.map((_, index) => (index === level ? 1 : 0)),
          confidence: 1,
        };
      }
      break;
  }
  throw new JevError(
    `The ${name} answer for question "${key}" is ${JSON.stringify(value)}, which doesn't fit a ${question.type} question.`,
    { kind: "invalid_answer", provider: name },
  );
}
