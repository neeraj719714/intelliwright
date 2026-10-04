import {
  AISDKError,
  APICallError,
  experimental_evaluate,
  Experimental_EvaluationUnsupportedQuestionTypeError,
  RetryError,
  type Experimental_EvaluationModel,
  type Experimental_EvaluationQuestion,
} from "ai";
import { JevError, type JevErrorKind } from "../ai/errors.js";
import type { Answer, CustomProvider, Question } from "../ai/types.js";

type EvaluateArgs = Parameters<typeof experimental_evaluate>[0];
type AiSdkAnswer = Awaited<ReturnType<typeof experimental_evaluate>>["answers"][string];

export interface FromAiSdkOptions {
  /** Shown in errors and reports. Defaults to the model's provider and id. */
  name?: string;
  /** Most input tokens one request may use. Defaults to 32,000. */
  maxInputTokens?: number;
  /** Retries for transient failures, made by the AI SDK. Defaults to 2. */
  maxRetries?: number;
  headers?: Record<string, string>;
  providerOptions?: EvaluateArgs["providerOptions"];
}

/**
 * Uses an AI SDK evaluation model as `ai.provider`, for projects that already
 * use the AI SDK (`ai` 7.x). A model that answers a choice or a score without
 * probabilities counts as certain of its answer.
 *
 * ```ts
 * import { fromAiSdk } from "intelliwright/ai-sdk";
 * export default defineConfig({ ai: { provider: fromAiSdk(myEvaluationModel) } });
 * ```
 */
export function fromAiSdk(model: Experimental_EvaluationModel, options: FromAiSdkOptions = {}): CustomProvider {
  const name = options.name ?? (typeof model === "string" ? model : `${model.provider}/${model.modelId}`);
  return {
    name,
    ...(options.maxInputTokens === undefined ? {} : { maxInputTokens: options.maxInputTokens }),
    async evaluate({ state, questions }, { signal }) {
      try {
        const result = await experimental_evaluate({
          model,
          state: state as EvaluateArgs["state"],
          questions: questions as Record<string, Experimental_EvaluationQuestion>,
          abortSignal: signal,
          maxRetries: options.maxRetries,
          headers: options.headers,
          providerOptions: options.providerOptions,
        });
        const answers: Record<string, Answer> = {};
        for (const [key, answer] of Object.entries(result.answers)) answers[key] = toAnswer(answer, questions[key]);
        return {
          answers,
          model: result.response.modelId,
          usage: { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 },
        };
      } catch (error) {
        throw signal?.aborted ? error : toJevError(error, name);
      }
    },
  };
}

function toAnswer(answer: AiSdkAnswer, question: Question | undefined): Answer {
  switch (answer.type) {
    case "boolean":
      return { type: "boolean", probability: answer.probability };
    case "choice":
      return { type: "choice", choice: answer.choice, probabilities: answer.probabilities ?? { [answer.choice]: 1 } };
    case "score": {
      const levels = question?.type === "score" ? question.criteria.length : Math.ceil(answer.score) + 1;
      const probabilities = new Array<number>(levels).fill(0);
      if (answer.probabilities) {
        for (const [level, p] of Object.entries(answer.probabilities)) probabilities[Number(level)] = p;
      } else {
        // Split between the two nearest levels so the weighted mean stays the score.
        const low = Math.floor(answer.score);
        const high = Math.ceil(answer.score);
        probabilities[low] = low === high ? 1 : high - answer.score;
        if (high !== low) probabilities[high] = answer.score - low;
      }
      return { type: "score", score: answer.score, probabilities };
    }
  }
}

function toJevError(error: unknown, provider: string): unknown {
  if (!AISDKError.isInstance(error)) return error;
  const cause = RetryError.isInstance(error) && AISDKError.isInstance(error.lastError) ? error.lastError : error;
  if (Experimental_EvaluationUnsupportedQuestionTypeError.isInstance(cause)) {
    return new JevError(`${provider} doesn't support ${cause.questionType} questions.`, {
      kind: "invalid_request",
      provider,
      cause: error,
    });
  }
  const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;
  return new JevError(`${provider} failed${status ? ` with status ${status}` : ""}: ${cause.message}`, {
    kind: errorKind(cause, status),
    provider,
    status,
    cause: error,
  });
}

function errorKind(error: AISDKError, status: number | undefined): JevErrorKind {
  if (status === undefined) return APICallError.isInstance(error) ? "network" : "invalid_answer";
  if (status === 401) return "auth";
  if (status === 402) return "payment";
  if (status === 403) return "forbidden";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limited";
  return status >= 500 ? "server" : "invalid_request";
}
