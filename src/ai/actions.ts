import type { ElementHandle, Locator, Page } from "playwright-core";
import { LocatorCache } from "./cache.js";
import { findCandidates, rankCandidates, type ActionKind, type Candidate } from "./candidates.js";
import { buildLocator, locatorCode, type LocatorDescriptor } from "./locators.js";
import type { AiRuntime } from "./runtime.js";
import { estimateQuestionTokens } from "./tokens.js";
import type { ChoiceQuestion } from "./types.js";

export interface ActionOptions {
  /** Probability Jev's pick needs. Defaults to the config's `ai.minProbability`. */
  minProbability?: number;
  /** Milliseconds for the Playwright action itself. */
  timeout?: number;
}

export interface ResolvedTarget {
  locator: Locator;
  /** The locator as Playwright code. */
  code: string;
  cached: boolean;
  /** The element as Jev saw it. */
  element: string;
}

const VERBS: Record<ActionKind, string> = {
  click: "clicked",
  fill: "filled in",
  select: "used to pick an option",
  check: "checked or unchecked",
  hover: "hovered",
  locate: "located",
};

const NOUNS: Record<ActionKind, string> = {
  click: "clickable elements",
  fill: "text fields",
  select: "select boxes",
  check: "checkboxes, radio buttons or switches",
  hover: "elements to hover",
  locate: "elements",
};

/** How long a cached locator gets to appear before it's resolved again. */
const CACHE_GRACE_MS = 2_000;

export class ActionError extends Error {
  override readonly name: string = "ActionError";
}

/**
 * Finds the element an action describes: from the cache when its locator
 * still matches exactly one element, otherwise by asking Jev to choose among
 * the candidates. The choice is turned into a readable locator and cached.
 */
export async function resolveTarget(
  page: Page,
  runtime: AiRuntime,
  kind: ActionKind,
  description: string,
  options: ActionOptions = {},
): Promise<ResolvedTarget> {
  const cache = runtime.cache;
  const key = LocatorCache.key(page.url(), kind, description);
  const entry = cache && !runtime.settings.updateCache ? cache.get(key) : undefined;
  if (entry) {
    const locator = buildLocator(page, entry.locator);
    if (await matchesOne(locator, CACHE_GRACE_MS)) {
      return { locator, code: locatorCode(entry.locator), cached: true, element: entry.element };
    }
  }

  const startTime = Date.now();
  // A default ARIA snapshot (the page state) invalidates the element references
  // of an AI-mode one (the candidates), so the candidates are always read last.
  let { state } = await runtime.capture(page, QUESTION_RESERVE);
  let { candidates, criteria, question } = await choiceQuestion(page, kind, description);
  const needed = estimateQuestionTokens(question) + 200;
  if (needed > QUESTION_RESERVE) {
    ({ state } = await runtime.capture(page, needed));
    ({ candidates, criteria, question } = await choiceQuestion(page, kind, description));
  }
  const result = await runtime.evaluate({ state, questions: { target: question } });
  const answer = result.answers.target;
  const probability = answer.probabilities[answer.choice] ?? 0;
  const min = options.minProbability ?? runtime.settings.minProbability;
  const chosen = candidates.find((candidate) => candidate.key === answer.choice);
  const accepted = Boolean(chosen) && probability >= min;

  runtime.record({
    kind: "action",
    question: `${kind}: ${description}`,
    answer: chosen?.description ?? "none",
    probability,
    confidence: answer.confidence,
    passed: accepted,
    model: result.model,
    startTime,
    durationMs: Date.now() - startTime,
  });

  if (!chosen || !accepted) {
    const best = Object.entries(answer.probabilities)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([option, p]) => `  ${p.toFixed(2)}  ${criteria[option] ?? option}`);
    const reason = chosen ? `isn't sure which element to use (${probability.toFixed(2)}, needs ${min.toFixed(2)})` : "found no matching element";
    throw new ActionError(
      `ai.${kind}(${JSON.stringify(description)}) ${reason}.\nBest matches:\n${best.join("\n")}\n` +
        "Describe the element more precisely, or use a fixed locator in the page object.",
    );
  }

  const readable = await readableLocator(page, chosen, runtime.testIdAttribute);
  if (readable.descriptor && cache) {
    cache.set(key, { locator: readable.descriptor, element: chosen.description, updated: new Date().toISOString() });
  }
  return { locator: readable.locator, code: readable.code, cached: false, element: chosen.description };
}

/** Tokens set aside for the choice question when capturing the page state. */
const QUESTION_RESERVE = 3_000;

async function choiceQuestion(
  page: Page,
  kind: ActionKind,
  description: string,
): Promise<{ candidates: Candidate[]; criteria: Record<string, string>; question: ChoiceQuestion }> {
  const candidates = rankCandidates(await findCandidates(page, kind), description);
  if (candidates.length === 0) {
    throw new ActionError(`ai.${kind}(${JSON.stringify(description)}) found no ${NOUNS[kind]} on the page.`);
  }
  const criteria: Record<string, string> = {};
  for (const candidate of candidates) criteria[candidate.key] = candidate.description;
  criteria.none = "No element on the page matches";
  const question: ChoiceQuestion = {
    type: "choice",
    instructions: `Which element should be ${VERBS[kind]} for: ${JSON.stringify(description)}?`,
    criteria,
  };
  return { candidates, criteria, question };
}

async function matchesOne(locator: Locator, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if ((await locator.count().catch(() => 0)) === 1) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface Readable {
  locator: Locator;
  code: string;
  /** Undefined when only the snapshot reference works, which can't be cached. */
  descriptor: LocatorDescriptor | undefined;
}

/**
 * The most readable locator that matches exactly the chosen element: test id,
 * then role and name, then the same inside its landmark, then label,
 * placeholder or text, then role and name with an index.
 */
async function readableLocator(page: Page, candidate: Candidate, testIdAttribute: string): Promise<Readable> {
  const target = page.locator(`aria-ref=${candidate.ref}`);
  const handle = await target.elementHandle({ timeout: 2_000 });
  const fallback: Readable = { locator: target, code: `page.locator('aria-ref=${candidate.ref}')`, descriptor: undefined };
  if (!handle) return fallback;

  try {
    const options: LocatorDescriptor[] = [];
    const testId = await handle.getAttribute(testIdAttribute).catch(() => null);
    if (testId) options.push({ kind: "testId", value: testId });
    if (candidate.name) {
      options.push({ kind: "role", role: candidate.role, name: candidate.name });
      if (candidate.landmark) options.push({ kind: "role", role: candidate.role, name: candidate.name, within: candidate.landmark });
      if (["textbox", "searchbox", "combobox", "spinbutton", "checkbox", "radio", "switch"].includes(candidate.role)) {
        options.push({ kind: "label", text: candidate.name });
      }
    }
    if (candidate.placeholder) options.push({ kind: "placeholder", text: candidate.placeholder });
    if (candidate.text) options.push({ kind: "text", text: candidate.text });

    for (const descriptor of options) {
      const locator = buildLocator(page, descriptor);
      if ((await locator.count()) === 1 && (await isSame(locator, handle))) {
        return { locator, code: locatorCode(descriptor), descriptor };
      }
    }
    if (candidate.name) {
      const all = buildLocator(page, { kind: "role", role: candidate.role, name: candidate.name });
      const index = await all.evaluateAll((elements, element) => (elements as Element[]).indexOf(element as Element), handle);
      if (index >= 0) {
        const descriptor: LocatorDescriptor = { kind: "role", role: candidate.role, name: candidate.name, nth: index };
        return { locator: buildLocator(page, descriptor), code: locatorCode(descriptor), descriptor };
      }
    }
    return fallback;
  } finally {
    await handle.dispose().catch(() => {});
  }
}

async function isSame(locator: Locator, handle: ElementHandle): Promise<boolean> {
  return locator.evaluate((element, other) => element === other, handle).catch(() => false);
}
