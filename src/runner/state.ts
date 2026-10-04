import type { AiRuntime } from "../ai/runtime.js";
import type { ResolvedConfig } from "../config/types.js";
import type { SuiteNode } from "./tree.js";
import type { Location, StepCategory, StepResult, TestInfo } from "./types.js";

export interface Collecting {
  file: string;
  root: SuiteNode;
  /** The describe blocks being collected, innermost last. */
  stack: SuiteNode[];
}

/** What matchers, steps and AI features need from the test that is running. */
export interface RunningTest {
  info: TestInfo;
  config: ResolvedConfig;
  runStep<T>(title: string, category: StepCategory, body: () => T | Promise<T>, location?: Location): Promise<T>;
  /** Adds a step that has already finished, such as a matcher. */
  recordStep(step: Omit<StepResult, "depth">): void;
  /** Jev access, decisions and settings for this attempt. */
  ai: AiRuntime;
}

export interface SharedState {
  collecting?: Collecting;
  running?: RunningTest;
}

const KEY = Symbol.for("intelliwright");

/**
 * State lives on `globalThis`, so test files and the runner share it even if
 * jiti loads a second copy of the package.
 */
export function shared(): SharedState {
  const store = globalThis as { [KEY]?: SharedState };
  store[KEY] ??= {};
  return store[KEY];
}
