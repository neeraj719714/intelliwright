import { JevError } from "../errors.js";
import { describeErrorBody, postJson } from "../http.js";
import type { EvaluateOptions, EvaluateRequest, EvaluateResult, Questions, TokenBudget } from "../types.js";
import { isRecord } from "../validate.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  parseSystemOneResponse,
  toWireQuestions,
  type HttpClientOptions,
  type ProviderClient,
} from "./system-one.js";

export interface CloudflareOptions extends HttpClientOptions {
  accountId: string;
  apiToken: string;
  model: string;
  baseURL?: string;
  budget: TokenBudget;
}

const NAME = "Cloudflare Workers AI";

/**
 * Workers AI wraps the System One body as `{ model, input: { state, questions } }`
 * and may wrap the answer in a `{ result, success, errors }` envelope.
 */
export function createCloudflareClient(options: CloudflareOptions): ProviderClient {
  const base = (options.baseURL ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  const url = `${base}/accounts/${encodeURIComponent(options.accountId)}/ai/run`;
  return {
    name: NAME,
    model: options.model,
    budget: options.budget,
    async evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      evaluateOptions?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      const { json, requestId } = await postJson({
        provider: NAME,
        url,
        apiKey: options.apiToken,
        keyHint: "CLOUDFLARE_API_TOKEN",
        body: {
          model: options.model,
          input: { state: request.state, questions: toWireQuestions(request.questions) },
        },
        headers: options.headers,
        fetch: options.fetch ?? fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
        retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
        signal: evaluateOptions?.signal,
      });
      if (isRecord(json) && json.success === false) {
        const { message } = describeErrorBody(JSON.stringify(json));
        throw new JevError(`${NAME} rejected the request${message ? `: ${message}` : ""}`, {
          kind: "invalid_request",
          provider: NAME,
          requestId,
        });
      }
      const body = isRecord(json) && "result" in json ? json.result : json;
      return parseSystemOneResponse(body, request.questions, NAME, options.model);
    },
  };
}
