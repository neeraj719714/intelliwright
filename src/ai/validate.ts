import { JevError } from "./errors.js";
import type { Answer, Answers, Question, Questions } from "./types.js";

const TOLERANCE = 1e-6;

/**
 * Checks that every question got an answer of its own type, that every
 * probability is between 0 and 1, and that every choice is one of the options
 * that were sent. Missing choice options get probability 0.
 */
export function validateAnswers<Qs extends Questions>(
  questions: Qs,
  raw: unknown,
  provider: string,
): Answers<Qs> {
  if (!isRecord(raw)) {
    throw invalid(provider, "the response has no answers object");
  }
  const answers: Record<string, Answer> = {};
  for (const [key, question] of Object.entries(questions)) {
    answers[key] = validateAnswer(key, question, raw[key], provider);
  }
  return answers as Answers<Qs>;
}

function validateAnswer(key: string, question: Question, value: unknown, provider: string): Answer {
  const where = `question "${key}"`;
  if (!isRecord(value)) {
    throw invalid(provider, `there is no answer for ${where}`);
  }
  if (value.type !== question.type) {
    throw invalid(
      provider,
      `${where} is a ${question.type} question, but its answer has type ${JSON.stringify(value.type)}`,
    );
  }

  switch (question.type) {
    case "boolean":
      return {
        type: "boolean",
        probability: probability(value.probability, `the probability for ${where}`, provider),
      };

    case "choice": {
      const options = Object.keys(question.criteria);
      if (typeof value.choice !== "string" || !options.includes(value.choice)) {
        throw invalid(
          provider,
          `${where} was answered with ${JSON.stringify(value.choice)}, which is not one of the options sent (${options.join(", ")})`,
        );
      }
      if (!isRecord(value.probabilities)) {
        throw invalid(provider, `the answer to ${where} has no probabilities`);
      }
      const probabilities: Record<string, number> = {};
      for (const option of options) probabilities[option] = 0;
      for (const [option, p] of Object.entries(value.probabilities)) {
        if (!options.includes(option)) {
          throw invalid(provider, `the answer to ${where} has a probability for "${option}", which is not one of the options sent`);
        }
        probabilities[option] = probability(p, `the probability of "${option}" for ${where}`, provider);
      }
      return {
        type: "choice",
        choice: value.choice,
        probabilities,
        ...confidence(value.confidence, where, provider),
      };
    }

    case "score": {
      const levels = question.criteria.length;
      const score = value.score;
      if (typeof score !== "number" || !Number.isFinite(score) || score < -TOLERANCE || score > levels - 1 + TOLERANCE) {
        throw invalid(provider, `the score for ${where} is ${JSON.stringify(score)}, outside the levels 0 to ${levels - 1}`);
      }
      return {
        type: "score",
        score: clamp(score, 0, levels - 1),
        probabilities: levelProbabilities(value.probabilities, levels, where, provider),
        ...confidence(value.confidence, where, provider),
      };
    }
  }
}

function levelProbabilities(raw: unknown, levels: number, where: string, provider: string): number[] {
  const result = new Array<number>(levels).fill(0);
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((p, i) => [String(i), p])
    : isRecord(raw)
      ? Object.entries(raw)
      : [];
  if (entries.length === 0) {
    throw invalid(provider, `the answer to ${where} has no probabilities`);
  }
  for (const [level, p] of entries) {
    const index = Number(level);
    if (!Number.isInteger(index) || index < 0 || index >= levels) {
      throw invalid(provider, `the answer to ${where} has a probability for level "${level}", but only levels 0 to ${levels - 1} were sent`);
    }
    result[index] = probability(p, `the probability of level ${index} for ${where}`, provider);
  }
  return result;
}

function confidence(raw: unknown, where: string, provider: string): { confidence?: number } {
  if (raw === undefined || raw === null) return {};
  return { confidence: probability(raw, `the confidence for ${where}`, provider) };
}

function probability(raw: unknown, what: string, provider: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < -TOLERANCE || raw > 1 + TOLERANCE) {
    throw invalid(provider, `${what} is ${JSON.stringify(raw)}, not a number from 0 to 1`);
  }
  return clamp(raw, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function invalid(provider: string, detail: string): JevError {
  return new JevError(`${provider} returned an invalid answer: ${detail}.`, {
    kind: "invalid_answer",
    provider,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
