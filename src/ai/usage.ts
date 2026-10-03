import type { EvaluateResult } from "./types.js";

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** True when any request's cost was estimated instead of reported. */
  costEstimated: boolean;
  /** Model versions that answered, such as `jev-1.13.0`. */
  models: string[];
}

export function emptyUsage(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costEstimated: false, models: [] };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
    costEstimated: a.costEstimated || b.costEstimated,
    models: [...new Set([...a.models, ...b.models])],
  };
}

/** Counts every request that reached a provider. */
export class UsageTracker {
  #totals: UsageTotals = emptyUsage();

  record(result: Pick<EvaluateResult, "model" | "usage" | "costUsd" | "costEstimated">): void {
    this.#totals = addUsage(this.#totals, {
      calls: 1,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.costUsd,
      costEstimated: result.costEstimated,
      models: [result.model],
    });
  }

  totals(): UsageTotals {
    return { ...this.#totals, models: [...this.#totals.models] };
  }
}
