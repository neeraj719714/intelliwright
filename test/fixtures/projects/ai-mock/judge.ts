import type { EvaluateRequest } from "intelliwright";
import type { MockAnswer } from "intelliwright/testing";

const SECRETS = ["s3cret-pass", "4242-4242-4242-4242", "private note"];

/**
 * A predictable stand-in for Jev. A claim with "[p=0.42]" gets that
 * probability; otherwise a claim holds when the text it quotes is on the page.
 */
export function judge({ state, questions }: EvaluateRequest): Record<string, MockAnswer> {
  const page = JSON.stringify(state);
  const aria = typeof state === "object" && state !== null && "aria" in state ? String(state.aria) : page;
  const answers: Record<string, MockAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const text = String(question.instructions);
    if (key === "loading") {
      answers[key] = /Loading/.test(aria) ? 0.9 : 0.05;
    } else if (text === "[leak]") {
      answers[key] = SECRETS.some((secret) => page.includes(secret)) ? 1 : 0;
    } else if (text === "[redacted-present]") {
      answers[key] = page.includes("[redacted]") ? 1 : 0;
    } else if (/\[p=([\d.]+)\]/.test(text)) {
      answers[key] = Number(/\[p=([\d.]+)\]/.exec(text)![1]);
    } else if (question.type === "boolean") {
      const quoted = /"([^"]+)"/.exec(text)?.[1];
      answers[key] = quoted && aria.includes(quoted) ? 0.95 : 0.05;
    } else if (question.type === "score") {
      answers[key] = aria.includes("clear message") ? 3 : 1;
    } else {
      answers[key] = Object.keys(question.criteria)[0]!;
    }
  }
  return answers;
}
