import type { Page, Route } from "playwright-core";
import { readableLocator } from "./actions.js";
import { findCandidates, MAX_CANDIDATES, rankCandidates, type Candidate } from "./candidates.js";
import type { AiRuntime } from "./runtime.js";
import { estimateQuestionTokens } from "./tokens.js";
import type { BooleanQuestion, ChoiceAnswer, ChoiceQuestion, Question } from "./types.js";

export interface RunOptions {
  /** Values for text fields. Jev picks which key goes into which field, so it never has to write text. */
  data?: Record<string, string>;
  /** Most actions before giving up. Defaults to 10. */
  maxSteps?: number;
  /** Elements to never use, in plain English, such as "the Delete account button". */
  avoid?: string[];
  /** Probability each pick needs. Defaults to the config's `ai.minProbability`. */
  minProbability?: number;
}

export interface RunStep {
  index: number;
  action: "click" | "fill";
  /** The element as Jev saw it. */
  element: string;
  /** The step as Playwright code. */
  code: string;
  dataKey?: string;
  probability: number;
  url: string;
}

export type RunStopReason = "goal-met" | "stuck" | "max-steps" | "missing-data";

export interface RunResult {
  goal: string;
  goalMet: boolean;
  reason: RunStopReason;
  steps: RunStep[];
  /** The same flow as fixed Playwright code, with text values read from `data`. */
  code: string;
  /** Why the run stopped, when it didn't reach the goal. */
  detail?: string;
  /** Navigations to other origins that the run blocked. */
  blockedNavigations: string[];
}

export class GoalNotReachedError extends Error {
  override readonly name: string = "GoalNotReachedError";
  readonly result: RunResult;

  constructor(result: RunResult) {
    const steps = result.steps.map((step) => `  ${step.index}. ${step.action} ${step.element}`).join("\n");
    const blocked = result.blockedNavigations.length
      ? `\nBlocked navigations to other origins: ${[...new Set(result.blockedNavigations)].join(", ")}`
      : "";
    super(
      `ai.run(${JSON.stringify(result.goal)}) stopped without reaching the goal (${result.reason}` +
        `${result.steps.length ? ` after ${result.steps.length} step${result.steps.length === 1 ? "" : "s"}` : ""}).` +
        `${result.detail ? `\n${result.detail}` : ""}${blocked}${steps ? `\nSteps:\n${steps}` : ""}`,
    );
    this.result = result;
  }
}

/** Tokens set aside for a step's questions when capturing the page state. */
const QUESTION_RESERVE = 4_000;

/**
 * Works towards a goal one action at a time. Each step is one Jev request:
 * is the goal met, which element comes next (or `stuck`), is an error or a
 * blocking dialog showing, and which element each `avoid` description means.
 * Text fields get a value from `data`, chosen by key in a second request.
 * Navigations away from the base URL's origin are blocked.
 */
export async function runGoal(page: Page, runtime: AiRuntime, goal: string, options: RunOptions = {}): Promise<RunResult> {
  const maxSteps = options.maxSteps ?? 10;
  const data = options.data ?? {};
  const avoid = options.avoid ?? [];
  const min = options.minProbability ?? runtime.settings.minProbability;
  const origin = new URL(runtime.baseURL ?? page.url()).origin;
  const steps: RunStep[] = [];
  const blockedNavigations: string[] = [];
  const tried = new Set<string>();

  const finish = (reason: RunStopReason, detail?: string): RunResult => {
    const code = steps.map((step) => step.code).join("\n");
    runtime.attach(
      `ai.run: ${goal}`,
      `// What ai.run did for: ${JSON.stringify(goal)}\n// Text values come from the data passed to ai.run.\n${code || "// (no steps)"}\n`,
    );
    return { goal, goalMet: reason === "goal-met", reason, steps, code, detail, blockedNavigations };
  };

  const guard = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && new URL(request.url()).origin !== origin) {
      blockedNavigations.push(request.url());
      // A 204 keeps the current document; aborting would leave an error page.
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  };
  await page.route("**/*", guard);

  try {
    for (;;) {
      const url = page.url();
      // The page state (a default ARIA snapshot) must come before the candidates
      // (an AI-mode one), whose element references it would invalidate.
      let { state, hash } = await runtime.capture(page, QUESTION_RESERVE);
      let candidates = await stepCandidates(page, goal, origin);
      let questions = stepQuestions(goal, candidates, avoid);
      const needed = Object.values(questions).reduce((sum, question) => sum + estimateQuestionTokens(question), 0);
      if (needed > QUESTION_RESERVE) {
        ({ state, hash } = await runtime.capture(page, needed + 200));
        candidates = await stepCandidates(page, goal, origin);
        questions = stepQuestions(goal, candidates, avoid);
      }

      const startTime = Date.now();
      const result = await runtime.evaluate({ state, questions });
      const goalProbability = result.answers.goalMet?.type === "boolean" ? result.answers.goalMet.probability : 0;
      const next = result.answers.nextStep as ChoiceAnswer | undefined;
      const problem = result.answers.problem?.type === "boolean" && result.answers.problem.probability >= 0.5;
      // Jev is cautious about calling a goal done. When nothing on the page
      // moves towards the goal, no error is showing, and done is the likelier
      // answer, the run has finished.
      const nothingLeft = next ? (next.probabilities.stuck ?? 0) >= min : true;
      if (goalProbability >= min || (nothingLeft && !problem && goalProbability >= 0.5)) {
        record(runtime, "goal reached?", "yes", goalProbability, true, result.model, startTime);
        return finish("goal-met");
      }
      if (steps.length >= maxSteps) return finish("max-steps", `The goal wasn't reached within ${maxSteps} steps.`);

      if (!next) return finish("stuck", "There is nothing on the page to use.");
      const avoided = new Set<string>();
      avoid.forEach((_, index) => {
        const answer = result.answers[`avoid${index}`] as ChoiceAnswer | undefined;
        if (answer && answer.choice !== "none" && (answer.probabilities[answer.choice] ?? 0) >= 0.5) avoided.add(answer.choice);
      });
      const [choice, probability] = Object.entries(next.probabilities)
        .filter(([option]) => !avoided.has(option))
        .sort(([, a], [, b]) => b - a)[0] ?? ["stuck", 1];
      const candidate = candidates.find((item) => item.key === choice);
      record(runtime, `step ${steps.length + 1}: ${goal}`, candidate?.description ?? "stuck", probability, Boolean(candidate) && probability >= min, result.model, startTime);
      if (!candidate) {
        return finish("stuck", `Nothing on the page seemed to move towards the goal${problem ? ", and an error or a blocking dialog was showing" : ""}.`);
      }
      if (probability < min) {
        return finish("stuck", `Jev wasn't sure what to do next: ${candidate.description} (${probability.toFixed(2)}, needs ${min.toFixed(2)}).`);
      }
      const attempt = `${hash} ${candidate.description}`;
      if (tried.has(attempt)) {
        return finish("stuck", `${candidate.description} was chosen again, but using it last time changed nothing.`);
      }
      tried.add(attempt);

      const readable = await readableLocator(page, candidate, runtime.testIdAttribute);
      if (candidate.fillable) {
        const keys = Object.keys(data);
        if (keys.length === 0) {
          return finish("missing-data", `The next step is to fill in ${candidate.description}, but ai.run was given no data.`);
        }
        const valueStart = Date.now();
        // Each option names its key and the kind of value, never the value itself.
        // A "none" option would draw probability away even from a clear match.
        const value = await runtime.evaluate({
          state,
          questions: {
            value: {
              type: "choice",
              instructions: `Which value belongs in the field ${candidate.description}?`,
              criteria: Object.fromEntries(keys.map((key) => [key, `${key}: ${describeValue(data[key]!)}`])),
            },
          },
        });
        const picked = value.answers.value;
        const valueProbability = picked.probabilities[picked.choice] ?? 0;
        record(runtime, `value for ${candidate.description}`, picked.choice, valueProbability, valueProbability >= min, value.model, valueStart);
        if (valueProbability < min) {
          return finish("missing-data", `None of the data keys (${keys.join(", ")}) clearly fits ${candidate.description}.`);
        }
        await runtime.step(`step ${steps.length + 1}: fill ${candidate.description}`, () => readable.locator.fill(data[picked.choice]!));
        steps.push({
          index: steps.length + 1,
          action: "fill",
          element: candidate.description,
          code: `await ${readable.code}.fill(${dataReference(picked.choice)});`,
          dataKey: picked.choice,
          probability,
          url,
        });
      } else {
        await runtime.step(`step ${steps.length + 1}: click ${candidate.description}`, () => readable.locator.click());
        steps.push({ index: steps.length + 1, action: "click", element: candidate.description, code: `await ${readable.code}.click();`, probability, url });
      }
      await settle(page);
    }
  } finally {
    await page.unroute("**/*", guard).catch(() => {});
  }
}

async function stepCandidates(page: Page, goal: string, origin: string): Promise<Candidate[]> {
  const all = await findCandidates(page, "run");
  const sameOrigin = all.filter((candidate) => {
    if (!candidate.url) return true;
    try {
      return new URL(candidate.url, page.url()).origin === origin;
    } catch {
      return true;
    }
  });
  return rankCandidates(sameOrigin, goal, MAX_CANDIDATES - 1);
}

function stepQuestions(goal: string, candidates: Candidate[], avoid: string[]): Record<string, Question> {
  const options = Object.fromEntries(candidates.map((candidate) => [candidate.key, candidate.description]));
  const questions: Record<string, Question> = {
    goalMet: { type: "boolean", instructions: `Does the page show that this has been done: ${JSON.stringify(goal)}?` } satisfies BooleanQuestion,
    problem: { type: "boolean", instructions: "Is an error message or a blocking dialog showing?" } satisfies BooleanQuestion,
  };
  if (candidates.length > 0) {
    questions.nextStep = {
      type: "choice",
      instructions: `Which element should be used next to reach this goal: ${JSON.stringify(goal)}?`,
      criteria: { ...options, stuck: "Nothing on the page moves towards the goal" },
    } satisfies ChoiceQuestion;
    avoid.forEach((description, index) => {
      questions[`avoid${index}`] = {
        type: "choice",
        instructions: `Which element is ${JSON.stringify(description)}?`,
        criteria: { ...options, none: "None of these" },
      } satisfies ChoiceQuestion;
    });
  }
  return questions;
}

function record(runtime: AiRuntime, question: string, answer: string, probability: number, passed: boolean, model: string, startTime: number): void {
  runtime.record({ kind: "run", question, answer, probability, passed, model, startTime, durationMs: Date.now() - startTime });
}

/** The kind of a data value, such as "an email address", without the value. */
export function describeValue(value: string): string {
  const text = value.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return "an email address";
  if (/^https?:\/\//i.test(text)) return "a URL";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return "a date";
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return "a number";
  if (/^\+?[\d\s().-]{7,}$/.test(text)) return "a phone number";
  const words = text ? text.split(/\s+/).length : 0;
  return words <= 1 ? "text, 1 word" : `text, ${words} words`;
}

function dataReference(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `data.${key}` : `data[${JSON.stringify(key)}]`;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
}
