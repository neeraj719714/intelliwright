import type { UseOptions } from "../config/types.js";
import { parameterNames, toLayer, type FixtureLayer } from "./fixtures.js";
import { callerLocation } from "./location.js";
import { shared, type Collecting } from "./state.js";
import { createSuite, type HookKind, type Mode, type SuiteNode, type TestNode } from "./tree.js";
import type {
  Annotation,
  BuiltinFixtures,
  TestDetails,
  TestInfo,
  WorkerFixtures,
  WorkerInfo,
} from "./types.js";

export type TestBody<F> = (fixtures: F, testInfo: TestInfo) => Promise<void> | void;
export type WorkerHookBody = (fixtures: WorkerFixtures, workerInfo: WorkerInfo) => Promise<void> | void;

/** Sets up a value, hands it over with `provide`, and cleans up after `provide` resolves. */
export type FixtureFunction<T, Deps> = (
  fixtures: Deps,
  provide: (value: T) => Promise<void>,
  testInfo: TestInfo,
) => Promise<void> | void;

export type FixtureDefinitions<Extra, Base> = {
  [K in keyof Extra]: FixtureFunction<Extra[K], Base & Extra> | Exclude<Extra[K], (...args: any[]) => any>;
};

export interface TestRegister<F> {
  (title: string, body: TestBody<F>): void;
  (title: string, details: TestDetails, body: TestBody<F>): void;
}

export interface SkipFunction<F> extends TestRegister<F> {
  /** Inside a test: skips the rest of it. Inside a describe: skips its tests. */
  (condition?: boolean, description?: string): void;
}

export interface DescribeFunction {
  (title: string, body: () => void): void;
  (title: string, details: TestDetails, body: () => void): void;
  only: DescribeFunction;
  skip: DescribeFunction;
}

export interface TestFunction<F> extends TestRegister<F> {
  only: TestRegister<F>;
  skip: SkipFunction<F>;
  fixme: SkipFunction<F>;
  describe: DescribeFunction;
  beforeEach(body: TestBody<F>): void;
  afterEach(body: TestBody<F>): void;
  beforeAll(body: WorkerHookBody): void;
  afterAll(body: WorkerHookBody): void;
  /** Groups actions under a title in reports. */
  step<T>(title: string, body: () => T | Promise<T>): Promise<T>;
  /** Browser context options for the tests in this file or describe. */
  use(options: UseOptions): void;
  /** Adds fixtures, such as page objects, that tests receive by name. */
  extend<Extra extends object>(fixtures: FixtureDefinitions<Extra, F>): TestFunction<F & Extra>;
  info(): TestInfo;
  setTimeout(timeout: number): void;
}

export class SkipSignal extends Error {
  override readonly name: string = "SkipSignal";
}

function collecting(what: string): Collecting {
  const state = shared();
  if (state.running) {
    throw new Error(`${what} can't be called while a test is running. Use test.step() to group work inside a test.`);
  }
  if (!state.collecting) {
    throw new Error(`${what} can only be called in a test file run by \`intelliwright test\`.`);
  }
  return state.collecting;
}

function currentSuite(state: Collecting): SuiteNode {
  return state.stack.at(-1) ?? state.root;
}

function parseTags(details: TestDetails | undefined, title: string): string[] {
  const own = details?.tag === undefined ? [] : Array.isArray(details.tag) ? details.tag : [details.tag];
  for (const tag of own) {
    if (typeof tag !== "string" || !tag.startsWith("@")) {
      throw new Error(`Tags must start with "@", as in { tag: "@smoke" }. Got ${JSON.stringify(tag)}.`);
    }
  }
  return [...new Set([...own, ...(title.match(/@[^\s@]+/g) ?? [])])];
}

function parseAnnotations(details: TestDetails | undefined): Annotation[] {
  if (!details?.annotation) return [];
  return Array.isArray(details.annotation) ? [...details.annotation] : [details.annotation];
}

function splitArgs<B>(what: string, title: unknown, second: unknown, third: unknown): { title: string; details: TestDetails; body: B } {
  if (typeof title !== "string") throw new Error(`${what} needs a title as its first argument.`);
  const body = typeof second === "function" ? second : third;
  const details = typeof second === "function" ? {} : ((second ?? {}) as TestDetails);
  if (typeof body !== "function") throw new Error(`${what}("${title}") needs a function as its last argument.`);
  return { title, details, body: body as B };
}

function registerTest(mode: Mode, layers: readonly FixtureLayer[], args: unknown[]): void {
  const state = collecting("test()");
  const { title, details, body } = splitArgs<(...a: any[]) => unknown>("test()", args[0], args[1], args[2]);
  const suite = currentSuite(state);
  const node: TestNode = {
    kind: "test",
    id: "",
    title,
    titlePath: [],
    location: callerLocation(state.file),
    tags: parseTags(details, title),
    mode,
    skipReason: undefined,
    annotations: parseAnnotations(details),
    body,
    deps: parameterNames(body, `The test "${title}"`),
    layers,
    parent: suite,
    skipped: false,
    only: false,
  };
  suite.children.push(node);
}

function skipOrRegister(mode: "skip" | "fixme", layers: readonly FixtureLayer[], args: unknown[]): void {
  if (typeof args[0] === "string" && (typeof args[1] === "function" || typeof args[2] === "function")) {
    registerTest(mode, layers, args);
    return;
  }
  const [condition = true, description] = args as [boolean | undefined, string | undefined];
  const state = shared();
  if (state.running) {
    if (condition) {
      state.running.info.annotations.push({ type: mode, description });
      throw new SkipSignal(description ?? "skipped");
    }
    return;
  }
  const collection = collecting(`test.${mode}()`);
  if (condition) {
    const suite = currentSuite(collection);
    suite.mode = mode;
    suite.skipReason = description;
  }
}

function addHook(kind: HookKind, layers: readonly FixtureLayer[], fn: unknown): void {
  const state = collecting(`test.${kind}()`);
  if (typeof fn !== "function") throw new Error(`test.${kind}() needs a function.`);
  const hook = fn as (...args: any[]) => unknown;
  currentSuite(state).hooks[kind].push({
    kind,
    fn: hook,
    deps: parameterNames(hook, `The ${kind} hook`),
    layers,
    location: callerLocation(state.file),
  });
}

function createDescribe(mode: Mode): DescribeFunction {
  const describe = ((title: unknown, second: unknown, third: unknown) => {
    const state = collecting("test.describe()");
    const { title: name, details, body } = splitArgs<() => unknown>("test.describe()", title, second, third);
    const parent = currentSuite(state);
    const suite = createSuite(name, callerLocation(state.file), parent);
    suite.mode = mode;
    suite.tags = parseTags(details, name);
    parent.children.push(suite);
    state.stack.push(suite);
    try {
      const result = body();
      if (result instanceof Promise) {
        throw new Error(`test.describe("${name}") must not be async. Register tests synchronously inside it.`);
      }
    } finally {
      state.stack.pop();
    }
  }) as DescribeFunction;
  return describe;
}

function createTestFunction<F>(layers: readonly FixtureLayer[]): TestFunction<F> {
  const test = ((...args: unknown[]) => registerTest("default", layers, args)) as TestFunction<F>;
  test.only = ((...args: unknown[]) => registerTest("only", layers, args)) as TestRegister<F>;
  test.skip = ((...args: unknown[]) => skipOrRegister("skip", layers, args)) as SkipFunction<F>;
  test.fixme = ((...args: unknown[]) => skipOrRegister("fixme", layers, args)) as SkipFunction<F>;
  const describe = createDescribe("default");
  describe.only = createDescribe("only");
  describe.skip = createDescribe("skip");
  test.describe = describe;
  test.beforeEach = (body) => addHook("beforeEach", layers, body);
  test.afterEach = (body) => addHook("afterEach", layers, body);
  test.beforeAll = (body) => addHook("beforeAll", layers, body);
  test.afterAll = (body) => addHook("afterAll", layers, body);
  test.step = async (title, body) => {
    const running = shared().running;
    if (!running) throw new Error("test.step() can only be called while a test is running.");
    return running.runStep(title, "step", body);
  };
  test.use = (options) => {
    currentSuite(collecting("test.use()")).use.push(options);
  };
  test.extend = <Extra extends object>(fixtures: FixtureDefinitions<Extra, F>) =>
    createTestFunction<F & Extra>([...layers, toLayer(fixtures as Record<string, unknown>)]);
  test.info = () => {
    const running = shared().running;
    if (!running) throw new Error("test.info() can only be called while a test is running.");
    return running.info;
  };
  test.setTimeout = (timeout) => test.info().setTimeout(timeout);
  return test;
}

/** Declares tests. Fixtures such as `page` come from the destructured first parameter. */
export const test: TestFunction<BuiltinFixtures> = createTestFunction<BuiltinFixtures>([]);
