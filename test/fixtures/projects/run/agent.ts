import type { EvaluateRequest } from "intelliwright";
import type { MockAnswer } from "intelliwright/testing";

/**
 * A scripted stand-in for Jev in ai.run: fill empty fields, pick Pro, then
 * press the buttons that move forward. It always ranks "Delete account"
 * first, so only `avoid` keeps the run from using it.
 */
export function agent({ state, questions }: EvaluateRequest): Record<string, MockAnswer> {
  const aria = typeof state === "object" && state !== null && "aria" in state ? String(state.aria) : "";
  const lines = aria.split("\n").map((line) => line.trim());
  const answers: Record<string, MockAnswer> = {};

  for (const [key, question] of Object.entries(questions)) {
    if (key === "goalMet") {
      answers[key] = aria.includes("Welcome aboard") ? 0.95 : 0.02;
      continue;
    }
    if (key === "problem") {
      answers[key] = aria.includes("Something went wrong") ? 0.9 : 0.05;
      continue;
    }
    if (question.type !== "choice") {
      answers[key] = 0;
      continue;
    }

    const options = Object.entries(question.criteria).map(([option, description]) => ({ option, description: String(description) }));
    const fallback = (options.find(({ option }) => option === "stuck" || option === "none") ?? options[0]!).option;
    const ranked: string[] = [];
    if (key.startsWith("avoid")) {
      ranked.push(...options.filter(({ description }) => description.includes("Delete account")).map(({ option }) => option));
    } else if (key === "value") {
      const field = String(question.instructions).toLowerCase();
      ranked.push(...options.filter(({ option }) => option !== "none" && field.includes(option.toLowerCase())).map(({ option }) => option));
    } else {
      const empty = (description: string) => {
        const name = /^textbox "([^"]+)"/.exec(description)?.[1];
        return name !== undefined && lines.includes(`- textbox "${name}"`);
      };
      const preferences = [
        (description: string) => description.startsWith('button "Delete account"'),
        empty,
        (description: string) => description.startsWith('radio "Pro"') && lines.includes('- radio "Pro"'),
        ...["Get started", "Continue", "Create account", "Try again"].map(
          (label) => (description: string) => description.startsWith(`button "${label}"`),
        ),
      ];
      for (const prefers of preferences) {
        for (const { option, description } of options) {
          if (option !== "stuck" && prefers(description) && !ranked.includes(option)) ranked.push(option);
        }
      }
    }

    const probabilities: Record<string, number> = Object.fromEntries(options.map(({ option }) => [option, 0]));
    ranked.forEach((option, index) => (probabilities[option] = index === 0 ? 0.95 : 0.9 - index * 0.01));
    const choice = ranked[0] ?? fallback;
    if (choice === fallback) probabilities[fallback] = 0.95;
    answers[key] = { type: "choice", choice, probabilities, confidence: 0.9 };
  }
  return answers;
}
