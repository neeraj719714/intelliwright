import { withBatching } from "../batching.js";
import { Semaphore } from "../concurrency.js";
import { JevError } from "../errors.js";
import { estimateCostUsd } from "../pricing.js";
import { DEFAULT_BUDGET } from "../tokens.js";
import type {
  CustomProvider,
  Evaluator,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResult,
  Questions,
  TokenBudget,
} from "../types.js";
import { UsageTracker } from "../usage.js";
import { validateAnswers } from "../validate.js";
import { VERSION } from "../../version.js";
import { createCloudflareClient } from "./cloudflare.js";
import { createSystemOneClient, type HttpClientOptions, type ProviderClient } from "./system-one.js";

export type ProviderPreset = "typesafe" | "vercel" | "openrouter" | "cloudflare";

/** Any other host that implements TypeSafe's System One API. */
export interface CustomHost {
  baseURL: string;
  apiKey?: string;
  model?: string;
  /** Shown in errors and reports. Defaults to the host name. */
  name?: string;
  headers?: Record<string, string>;
}

export type ProviderSetting = ProviderPreset | CustomHost | CustomProvider;

export interface ProviderSettings {
  /** Defaults to the first provider whose key is set in the environment. */
  provider?: ProviderSetting;
  /** Overrides the preset's model, for example to pin `jev-1.13.0`. */
  model?: string;
  /** Overrides the key read from the environment. */
  apiKey?: string;
  /** Overrides a preset's base URL, for example to go through a proxy. */
  baseURL?: string;
  /** A custom `fetch`, for example one that goes through a corporate proxy. */
  fetch?: typeof fetch;
  /** Per-attempt timeout in milliseconds. Defaults to 30,000. */
  timeout?: number;
  /** Retries for 408, 429, 5xx, timeouts and network errors. Defaults to 3. */
  maxRetries?: number;
  /** Most requests in flight per worker. Defaults to 4. */
  maxConcurrency?: number;
}

/** A configured connection to Jev. */
export interface Jev {
  /** Shown in reports, such as "TypeSafe". */
  readonly provider: string;
  /** The model asked for, such as `jev-latest`. */
  readonly model: string;
  readonly budget: TokenBudget;
  /** Merges and splits requests, caps concurrency, and counts usage. */
  readonly evaluator: Evaluator;
  readonly usage: UsageTracker;
}

interface Preset {
  name: string;
  baseURL: string;
  model: string;
  keys: string[];
  budget: TokenBudget;
}

export const PRESETS: Record<ProviderPreset, Preset> = {
  typesafe: {
    name: "TypeSafe",
    baseURL: "https://api.typesafe.ai",
    model: "jev-latest",
    keys: ["TYPESAFE_API_KEY"],
    budget: { request: 64_000, stateAndQuestion: 32_000 },
  },
  vercel: {
    name: "Vercel AI Gateway",
    baseURL: "https://ai-gateway.vercel.sh/typesafe",
    model: "typesafe-ai/jev",
    keys: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
    budget: DEFAULT_BUDGET,
  },
  openrouter: {
    name: "OpenRouter",
    baseURL: "https://openrouter.ai/api",
    model: "~typesafe/jev-latest",
    keys: ["OPENROUTER_API_KEY"],
    budget: DEFAULT_BUDGET,
  },
  cloudflare: {
    name: "Cloudflare Workers AI",
    baseURL: "https://api.cloudflare.com/client/v4",
    model: "typesafe/jev",
    keys: ["CLOUDFLARE_API_TOKEN"],
    budget: DEFAULT_BUDGET,
  },
};

/** With no provider set, the first of these whose key is set is used. */
export const DETECTION_ORDER: readonly ProviderPreset[] = ["typesafe", "vercel", "openrouter", "cloudflare"];

type Env = Record<string, string | undefined>;

/** Returns undefined when no provider is set and no key is in the environment. */
export function resolveJev(settings: ProviderSettings = {}, env: Env = process.env): Jev | undefined {
  const client = createProviderClient(settings, env);
  return client ? assemble(client, settings) : undefined;
}

export function createProviderClient(settings: ProviderSettings, env: Env): ProviderClient | undefined {
  const { provider } = settings;
  if (provider === undefined) {
    const detected = DETECTION_ORDER.find((preset) => presetKey(preset, env) !== undefined);
    return detected ? presetClient(detected, settings, env) : undefined;
  }
  if (typeof provider === "string") {
    if (!Object.hasOwn(PRESETS, provider)) {
      throw new JevError(
        `Unknown ai.provider "${provider}". Use "typesafe", "vercel", "openrouter", "cloudflare", a { baseURL } host, or an object with an evaluate function.`,
        { kind: "config", provider },
      );
    }
    return presetClient(provider, settings, env);
  }
  if (typeof provider === "object" && provider !== null) {
    if ("evaluate" in provider && typeof provider.evaluate === "function") {
      return customClient(provider);
    }
    if ("baseURL" in provider && typeof provider.baseURL === "string") {
      return hostClient(provider, settings);
    }
  }
  throw new JevError(
    "ai.provider must be a preset name, a { baseURL } host, or an object with an evaluate function.",
    { kind: "config", provider: "custom" },
  );
}

function presetKey(preset: ProviderPreset, env: Env): string | undefined {
  if (preset === "cloudflare" && !env.CLOUDFLARE_ACCOUNT_ID?.trim()) return undefined;
  for (const name of PRESETS[preset].keys) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function httpOptions(settings: ProviderSettings, headers?: Record<string, string>): HttpClientOptions {
  return {
    fetch: settings.fetch,
    timeoutMs: settings.timeout,
    maxRetries: settings.maxRetries,
    headers: { "user-agent": `intelliwright/${VERSION}`, ...headers },
  };
}

function presetClient(preset: ProviderPreset, settings: ProviderSettings, env: Env): ProviderClient {
  const info = PRESETS[preset];
  const apiKey = settings.apiKey?.trim() || presetKey(preset, env);
  if (preset === "cloudflare" && !env.CLOUDFLARE_ACCOUNT_ID?.trim()) {
    throw new JevError(
      'ai.provider is "cloudflare", but CLOUDFLARE_ACCOUNT_ID is not set. Add it to .env.local.',
      { kind: "config", provider: info.name },
    );
  }
  if (!apiKey) {
    throw new JevError(
      `ai.provider is "${preset}", but ${info.keys.join(" or ")} is not set. Add it to .env.local, or set ai.apiKey.`,
      { kind: "config", provider: info.name },
    );
  }

  const model = settings.model ?? info.model;
  const baseURL = settings.baseURL ?? info.baseURL;
  if (preset === "cloudflare") {
    return createCloudflareClient({
      accountId: env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "",
      apiToken: apiKey,
      model,
      baseURL,
      budget: info.budget,
      ...httpOptions(settings),
    });
  }
  return createSystemOneClient({
    name: info.name,
    baseURL,
    apiKey,
    model,
    keyHint: info.keys.join(" or "),
    budget: info.budget,
    ...httpOptions(settings),
  });
}

function hostClient(host: CustomHost, settings: ProviderSettings): ProviderClient {
  return createSystemOneClient({
    name: host.name ?? hostName(host.baseURL),
    baseURL: settings.baseURL ?? host.baseURL,
    apiKey: settings.apiKey ?? host.apiKey ?? "",
    model: settings.model ?? host.model ?? "jev-latest",
    budget: DEFAULT_BUDGET,
    ...httpOptions(settings, host.headers),
  });
}

function customClient(provider: CustomProvider): ProviderClient {
  const name = provider.name ?? "custom";
  const budget = provider.maxInputTokens
    ? { request: provider.maxInputTokens, stateAndQuestion: provider.maxInputTokens }
    : DEFAULT_BUDGET;
  return {
    name,
    model: name,
    budget,
    async evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      options?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      const result = await provider.evaluate(request, { signal: options?.signal });
      const answers = validateAnswers(request.questions, result?.answers, name);
      const model = result.model ?? name;
      const usage = {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      };
      return {
        answers,
        model,
        usage,
        costUsd: result.costUsd ?? estimateCostUsd(model, usage),
        costEstimated: result.costUsd === undefined,
      };
    },
  };
}

function assemble(client: ProviderClient, settings: ProviderSettings): Jev {
  const usage = new UsageTracker();
  const limiter = new Semaphore(settings.maxConcurrency ?? 4);
  const counted: Evaluator = {
    async evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      options?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      const release = await limiter.acquire(options?.signal);
      try {
        const result = await client.evaluate(request, options);
        usage.record(result);
        return result;
      } finally {
        release();
      }
    },
  };
  return {
    provider: client.name,
    model: client.model,
    budget: client.budget,
    usage,
    evaluator: withBatching(counted, { budget: client.budget, provider: client.name }),
  };
}

function hostName(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}
