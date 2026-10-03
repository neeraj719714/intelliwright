import type { JsonValue, Question, TokenBudget } from "./types.js";

/**
 * Measured against Jev on TypeSafe: prose costs about 4.9 characters per
 * token, YAML and JSON page snapshots about 3. Three is the safe side.
 */
const CHARS_PER_TOKEN = 3;

/** Fixed input tokens TypeSafe adds to every request. */
export const REQUEST_OVERHEAD_TOKENS = 300;

/** Requests are planned against this share of the provider's limits. */
const BUDGET_MARGIN = 0.9;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateStateTokens(state: JsonValue): number {
  return estimateTokens(typeof state === "string" ? state : JSON.stringify(state));
}

export function estimateQuestionTokens(question: Question): number {
  return estimateTokens(JSON.stringify(question)) + 15;
}

export function usableBudget(budget: TokenBudget): TokenBudget {
  return {
    request: Math.floor(budget.request * BUDGET_MARGIN),
    stateAndQuestion: Math.floor(budget.stateAndQuestion * BUDGET_MARGIN),
  };
}

export const DEFAULT_BUDGET: TokenBudget = { request: 32_000, stateAndQuestion: 32_000 };
