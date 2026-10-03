import { JevError, type JevErrorKind } from "./errors.js";
import { isRecord } from "./validate.js";

export interface PostJsonOptions {
  /** Shown in errors, such as "TypeSafe". */
  provider: string;
  url: string;
  apiKey: string;
  /** The environment variable that holds the key, named in 401 errors. */
  keyHint?: string;
  body: unknown;
  headers?: Record<string, string>;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  /** First backoff delay. Doubles on each retry, up to 8 seconds. */
  retryDelayMs: number;
  signal?: AbortSignal;
}

export interface PostJsonResult {
  json: unknown;
  requestId: string | undefined;
}

const RETRY_STATUSES = new Set([408, 429]);
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * POSTs JSON and returns the parsed response. Retries 408, 429, 5xx (529
 * included), timeouts and network errors with exponential backoff that honors
 * `retry-after`. Other errors fail at once and name the provider and, for 422,
 * the rejected field. Error messages never include the API key.
 */
export async function postJson(options: PostJsonOptions): Promise<PostJsonResult> {
  const { provider, signal } = options;
  let lastFailure = "";

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();

    let retryAfterMs: number | undefined;
    const attemptController = new AbortController();
    const onAbort = (): void => attemptController.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => attemptController.abort(new JevTimeout()),
      options.timeoutMs,
    );

    try {
      const response = await options.fetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...options.headers,
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(options.body),
        signal: attemptController.signal,
      });
      const requestId = readRequestId(response.headers);
      const text = await response.text();

      if (response.ok) {
        try {
          return { json: JSON.parse(text) as unknown, requestId };
        } catch {
          throw new JevError(
            `${provider} returned a response that is not JSON: ${preview(text)}`,
            { kind: "invalid_answer", provider, status: response.status, requestId },
          );
        }
      }

      const detail = describeErrorBody(
        options.apiKey.length >= 8 ? text.replaceAll(options.apiKey, "[redacted]") : text,
      );
      if (!RETRY_STATUSES.has(response.status) && response.status < 500) {
        throw statusError(options, response.status, detail, requestId);
      }
      lastFailure = `${response.status} ${detail.message ?? response.statusText}`.trim();
      retryAfterMs = readRetryAfter(response.headers);
      if (attempt >= options.maxRetries) {
        throw new JevError(
          `${provider} failed after ${attempt + 1} attempts. Last response: ${lastFailure}`,
          { kind: response.status === 429 ? "rate_limited" : "server", provider, status: response.status, requestId },
        );
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof JevError) throw error;
      const timedOut = attemptController.signal.reason instanceof JevTimeout;
      lastFailure = timedOut
        ? `timed out after ${options.timeoutMs} ms`
        : `network error: ${describeCause(error)}`;
      if (attempt >= options.maxRetries) {
        throw new JevError(`${provider} failed after ${attempt + 1} attempts. Last error: ${lastFailure}`, {
          kind: timedOut ? "timeout" : "network",
          provider,
          cause: timedOut ? undefined : error,
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    await sleep(retryAfterMs ?? backoff(options.retryDelayMs, attempt), signal);
  }
}

class JevTimeout extends Error {
  override readonly name: string = "TimeoutError";
}

interface ErrorDetail {
  message?: string;
  field?: string;
}

function statusError(
  options: PostJsonOptions,
  status: number,
  detail: ErrorDetail,
  requestId: string | undefined,
): JevError {
  const { provider } = options;
  const said = detail.message ? `: ${detail.message}` : "";
  let kind: JevErrorKind = "invalid_request";
  let message: string;
  switch (status) {
    case 401:
      kind = "auth";
      message = `${provider} rejected the API key (401)${said}.${options.keyHint ? ` Check ${options.keyHint}.` : ""}`;
      break;
    case 402:
      kind = "payment";
      message = `${provider} declined the request (402 Payment Required)${said}`;
      break;
    case 403:
      kind = "forbidden";
      message = `${provider} refused the request (403)${said}`;
      break;
    default:
      message = `${provider} rejected the request (${status})${detail.field ? ` at "${detail.field}"` : ""}${said}`;
  }
  return new JevError(message, { kind, provider, status, requestId });
}

/** Reads the error shapes of TypeSafe, OpenRouter, Vercel and Cloudflare. */
export function describeErrorBody(text: string): ErrorDetail {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return text.trim() ? { message: preview(text) } : {};
  }
  if (!isRecord(json)) return {};

  const { detail } = json;
  if (typeof detail === "string") return { message: detail };
  if (Array.isArray(detail) && isRecord(detail[0])) {
    const first = detail[0];
    const loc = Array.isArray(first.loc) ? first.loc.filter((part) => part !== "body").join(".") : undefined;
    return {
      message: typeof first.msg === "string" ? first.msg : undefined,
      field: loc || undefined,
    };
  }
  if (isRecord(json.error) && typeof json.error.message === "string") {
    return { message: json.error.message };
  }
  if (typeof json.error === "string") return { message: json.error };
  if (Array.isArray(json.errors) && isRecord(json.errors[0]) && typeof json.errors[0].message === "string") {
    return { message: json.errors[0].message };
  }
  if (typeof json.message === "string") return { message: json.message };
  return {};
}

function readRequestId(headers: Headers): string | undefined {
  return (
    headers.get("x-typesafe-request-id") ??
    headers.get("x-request-id") ??
    headers.get("cf-ray") ??
    undefined
  );
}

function readRetryAfter(headers: Headers): number | undefined {
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.has("retry-after-ms") && Number.isFinite(ms) && ms >= 0) {
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

function backoff(baseMs: number, attempt: number): number {
  const delay = Math.min(baseMs * 2 ** attempt, 8_000);
  return delay * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const code = cause && "code" in cause ? ` (${String(cause.code)})` : "";
  return `${error.message}${cause ? `: ${cause.message}` : ""}${code}`;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}
