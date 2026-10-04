import type { EvaluateRequest } from "intelliwright";
import type { MockAnswer } from "intelliwright/testing";

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "that", "this", "with"]);
const words = (text: string): string[] => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => !STOP.has(word));

/**
 * A stand-in for Jev's element choice: the option that shares the most words
 * with the quoted description wins with probability 0.9.
 */
export function pick({ questions }: EvaluateRequest): Record<string, MockAnswer> {
  const answers: Record<string, MockAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    if (question.type !== "choice") {
      answers[key] = question.type === "boolean" ? 0.5 : 0;
      continue;
    }
    const wanted = new Set(words(/"([^"]+)"/.exec(String(question.instructions))?.[1] ?? ""));
    const options = Object.entries(question.criteria).filter(([option]) => option !== "none");
    const scored = options.map(([option, description]) => ({
      option,
      score: words(String(description)).filter((word) => wanted.has(word)).length,
    }));
    const best = scored.reduce((top, item) => (item.score > top.score ? item : top), { option: "none", score: 0 });
    const probabilities: Record<string, number> = { none: best.option === "none" ? 0.9 : 0 };
    for (const { option } of scored) probabilities[option] = option === best.option ? 0.9 : 0.1 / Math.max(1, scored.length - 1);
    answers[key] = { type: "choice", choice: best.option, probabilities, confidence: 0.8 };
  }
  return answers;
}
