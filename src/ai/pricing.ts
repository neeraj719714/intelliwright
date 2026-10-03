import type { Usage } from "./types.js";

/** US dollars per million input tokens. Jev's output tokens are free. */
const JEV_INPUT_PER_MILLION = 0.042;

/** Estimates the cost of a request when the provider doesn't report it. */
export function estimateCostUsd(model: string, usage: Usage): number {
  if (!/jev/i.test(model)) return 0;
  return (usage.inputTokens * JEV_INPUT_PER_MILLION) / 1_000_000;
}
