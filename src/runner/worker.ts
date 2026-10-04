import { existsSync } from "node:fs";
import { chromium, firefox, selectors, webkit, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createAi } from "../ai/fixture.js";
import { resolveJev, type Jev } from "../ai/providers/resolve.js";
import { AiRuntime } from "../ai/runtime.js";
import { emptyUsage, subtractUsage } from "../ai/usage.js";
import { ArtifactRecorder, finishArtifacts } from "./artifacts.js";
import { loadConfig } from "../config/load-config.js";
import type { ResolvedConfig, UseOptions } from "../config/types.js";
import { SkipSignal } from "./collect.js";
import { collectFile, type CollectedFile } from "./collect-file.js";
import { FixtureScope, type FixtureLayer } from "./fixtures.js";
import { serializeError } from "./location.js";
import type { MainMessage, WorkerInit, WorkerMessage } from "./protocol.js";
import { shared, type RunningTest } from "./state.js";
import { TestInfoImpl, TestTimeoutError } from "./test-info.js";
import { ancestors, type HookEntry, type SuiteNode, type TestNode } from "./tree.js";
import type {
  AttemptResult,
  Location,
  SerializedError,
  StepCategory,
  StepResult,
  TestStatus,
} from "./types.js";

const TEARDOWN_TIMEOUT_MS = 30_000;

/** Entry point of a forked worker process. */
export function runWorkerProcess(): void {
  process.setSourceMapsEnabled(true);
  const send = (message: WorkerMessage): void => {
    process.send?.(message);
  };
  let runner: WorkerRunner | undefined;
  let queue = Promise.resolve();

  process.on("unhandledRejection", (reason) => runner?.unhandled(reason));
  process.on("uncaughtException", (error) => runner?.unhandled(error));
  process.on("disconnect", () => process.exit(0));

  process.on("message", (message: MainMessage) => {
    queue = queue.then(async () => {
      try {
        if (message.type === "init") {
          runner = await WorkerRunner.create(message.init, send);
          send({ type: "ready" });
        } else if (message.type === "run") {
          const errors = await runner!.runJob(message.file, message.testIds);
          send({ type: "done", errors });
        } else if (message.type === "stop") {
          await runner?.close();
          process.disconnect?.();
          process.exit(0);
        }
      } catch (error) {
        send({ type: "fatal", error: serializeError(error, runner?.config.rootDir) });
        await runner?.close();
        process.exit(1);
      }
    });
  });
}

class StepRecorder {
  readonly steps: StepResult[] = [];
  #depth = 0;

  constructor(private readonly onEnd: (step: StepResult) => void) {}

  record = (step: Omit<StepResult, "depth">): void => {
    const recorded = { ...step, depth: this.#depth };
    this.steps.push(recorded);
    this.onEnd(recorded);
  };

  run = async <T>(title: string, category: StepCategory, body: () => T | Promise<T>, location?: Location): Promise<T> => {
    const step: StepResult = { title, category, startTime: Date.now(), duration: 0, depth: this.#depth, location };
    this.steps.push(step);
    this.#depth++;
    try {
      return await body();
    } catch (error) {
      if (!(error instanceof SkipSignal)) step.error = serializeError(error);
      throw error;
    } finally {
      this.#depth--;
      step.duration = Date.now() - step.startTime;
      this.onEnd(step);
    }
  };
}

/** Rejects with TestTimeoutError when the test's time runs out; follows setTimeout changes. */
class Deadline {
  readonly promise: Promise<never>;
  readonly #start = Date.now();
  readonly #info: TestInfoImpl;
  #timer: NodeJS.Timeout | undefined;
  #reject!: (error: Error) => void;

  constructor(info: TestInfoImpl) {
    this.#info = info;
    this.promise = new Promise<never>((_, reject) => (this.#reject = reject));
    this.promise.catch(() => {});
    info.onTimeoutChange = () => this.#arm();
    this.#arm();
  }

  #arm(): void {
    clearTimeout(this.#timer);
    const timeout = this.#info.timeout;
    if (timeout <= 0) return;
    const remaining = this.#start + timeout - Date.now();
    this.#timer = setTimeout(() => this.#reject(new TestTimeoutError(timeout)), Math.max(0, remaining));
  }

  stop(): void {
    clearTimeout(this.#timer);
    this.#info.onTimeoutChange = undefined;
  }
}

export class WorkerRunner {
  readonly config: ResolvedConfig;
  readonly #workerIndex: number;
  readonly #send: (message: WorkerMessage) => void;
  readonly #files = new Map<string, CollectedFile>();
  #browser: Promise<Browser> | undefined;
  #attemptErrors: unknown[] | undefined;
  #jevState: { jev?: Jev; error?: unknown } | undefined;

  private constructor(config: ResolvedConfig, workerIndex: number, send: (message: WorkerMessage) => void) {
    this.config = config;
    this.#workerIndex = workerIndex;
    this.#send = send;
    selectors.setTestIdAttribute(config.testIdAttribute);
  }

  static async create(init: WorkerInit, send: (message: WorkerMessage) => void): Promise<WorkerRunner> {
    const config = await loadConfig({ cwd: init.cwd, configFile: init.configFile, overrides: init.overrides });
    return new WorkerRunner(config, init.workerIndex, send);
  }

  /** Errors outside any test, such as unhandled rejections, belong to the running test if there is one. */
  unhandled(error: unknown): void {
    if (this.#attemptErrors) this.#attemptErrors.push(error);
    else process.stderr.write(`Unhandled error in worker ${this.#workerIndex}: ${String((error as Error)?.stack ?? error)}\n`);
  }

  browser(): Promise<Browser> {
    this.#browser ??= launch(this.config);
    return this.#browser;
  }

  /** The worker's Jev provider, resolved on first use. Throws if the AI config is invalid. */
  jev(): Jev | undefined {
    if (!this.#jevState) {
      try {
        this.#jevState = { jev: resolveJev(this.config.ai) };
      } catch (error) {
        this.#jevState = { error };
      }
    }
    if (this.#jevState.error) throw this.#jevState.error;
    return this.#jevState.jev;
  }

  async close(): Promise<void> {
    const browser = await this.#browser?.catch(() => undefined);
    await browser?.close().catch(() => {});
  }

  async runJob(file: string, testIds: string[]): Promise<SerializedError[]> {
    let collected = this.#files.get(file);
    if (!collected) {
      collected = await collectFile(file, this.config.rootDir);
      this.#files.set(file, collected);
    }
    const tests = testIds.flatMap((id) => collected.byId.get(id) ?? []);
    const lastIndex = new Map<SuiteNode, number>();
    tests.forEach((test, index) => {
      for (const suite of ancestors(test)) lastIndex.set(suite, index);
    });

    const errors: SerializedError[] = [];
    const started = new Set<SuiteNode>();
    const failedSetup = new Map<SuiteNode, SerializedError>();
    for (const [index, test] of tests.entries()) {
      for (const suite of ancestors(test)) {
        if (started.has(suite)) continue;
        started.add(suite);
        const error = await this.#runWorkerHooks(suite.hooks.beforeAll);
        if (error) failedSetup.set(suite, error);
      }
      const setupError = ancestors(test).map((suite) => failedSetup.get(suite)).find(Boolean);
      if (setupError) this.#reportNotRun(test, collected.relFile, setupError);
      else await this.#runTest(test, collected.relFile);

      for (const suite of [...ancestors(test)].reverse()) {
        if (lastIndex.get(suite) !== index) continue;
        const error = await this.#runWorkerHooks(suite.hooks.afterAll);
        if (error) errors.push({ ...error, message: `afterAll hook in ${collected.relFile}: ${error.message}` });
      }
    }
    return errors;
  }

  async #runWorkerHooks(hooks: HookEntry[]): Promise<SerializedError | undefined> {
    for (const hook of hooks) {
      const unknown = hook.deps.filter((dep) => dep !== "browser" && dep !== "browserName");
      try {
        if (unknown.length > 0) {
          throw new Error(`${hook.kind} hooks can only use the browser and browserName fixtures, not ${unknown.join(", ")}.`);
        }
        const fixtures = { browser: hook.deps.includes("browser") ? await this.browser() : undefined, browserName: this.config.browser };
        await withTimeout(Promise.resolve(hook.fn(fixtures, { workerIndex: this.#workerIndex })), this.config.timeout, `${hook.kind} hook`);
      } catch (error) {
        return serializeError(error, this.config.rootDir);
      }
    }
    return undefined;
  }

  #reportNotRun(test: TestNode, relFile: string, error: SerializedError): void {
    const info = new TestInfoImpl(test, relFile, 0, this.#workerIndex, this.config);
    const startTime = Date.now();
    this.#send({ type: "testBegin", testId: test.id, retry: 0, startTime });
    this.#send({
      type: "testEnd",
      testId: test.id,
      willRetry: false,
      result: {
        retry: 0,
        workerIndex: this.#workerIndex,
        status: "failed",
        startTime,
        duration: 0,
        errors: [{ ...error, message: `beforeAll hook failed: ${error.message}` }],
        steps: [],
        annotations: info.annotations,
        attachments: [],
      },
    });
  }

  async #runTest(test: TestNode, relFile: string): Promise<void> {
    for (let retry = 0; retry <= this.config.retries; retry++) {
      const result = await this.#runAttempt(test, relFile, retry);
      const willRetry = (result.status === "failed" || result.status === "timedOut") && retry < this.config.retries;
      this.#send({ type: "testEnd", testId: test.id, result, willRetry });
      if (!willRetry) return;
    }
  }

  async #runAttempt(test: TestNode, relFile: string, retry: number): Promise<AttemptResult> {
    const startTime = Date.now();
    const info = new TestInfoImpl(test, relFile, retry, this.#workerIndex, this.config);
    this.#send({ type: "testBegin", testId: test.id, retry, startTime });

    const errors: unknown[] = [];
    this.#attemptErrors = errors;
    const steps = new StepRecorder((step) => this.#send({ type: "stepEnd", testId: test.id, retry, step }));
    const ai = new AiRuntime({
      settings: {
        minProbability: this.config.ai.minProbability ?? 0.7,
        cache: this.config.ai.cache ?? true,
        updateCache: this.config.updateCache,
        redact: this.config.ai.redact ?? [],
      },
      jev: () => this.jev(),
      signal: info.signal,
      step: (title, body) => steps.run(title, "ai", body),
      rootDir: this.config.rootDir,
    });
    const usageBefore = this.#jevState?.jev?.usage.totals() ?? emptyUsage();
    const running: RunningTest = { info, config: this.config, runStep: steps.run, recordStep: steps.record, ai };
    shared().running = running;

    const scope = new FixtureScope(this.#builtins(test, ai), test.layers, info);
    const suites = ancestors(test);
    const beforeEach = suites.flatMap((suite) => suite.hooks.beforeEach);
    const afterEach = [...suites].reverse().flatMap((suite) => suite.hooks.afterEach);
    const deadline = new Deadline(info);
    let status = "passed" as TestStatus;

    const fail = (error: unknown): void => {
      if (error instanceof SkipSignal || (error as Error)?.name === "SkipSignal") {
        if (status === "passed") status = "skipped";
        return;
      }
      if (error instanceof TestTimeoutError) {
        status = "timedOut";
        info.abort(error);
      } else if (status !== "timedOut") {
        status = "failed";
      }
      errors.push(error);
    };

    const body = (async () => {
      for (const hook of beforeEach) {
        await steps.run("beforeEach hook", "hook", async () => hook.fn(await scope.values(hook.deps), info), hook.location);
      }
      await test.body(await scope.values(test.deps), info);
    })();
    body.catch(() => {});
    try {
      await Promise.race([body, deadline.promise]);
    } catch (error) {
      fail(error);
    }

    if (status !== "timedOut") {
      for (const hook of afterEach) {
        const run = steps.run("afterEach hook", "hook", async () => hook.fn(await scope.values(hook.deps), info), hook.location);
        run.catch(() => {});
        try {
          await Promise.race([run, deadline.promise]);
        } catch (error) {
          fail(error);
          if ((status as TestStatus) === "timedOut") break;
        }
      }
    }
    deadline.stop();
    if (errors.length > 0 && status === "passed") status = "failed";
    info.status = status;

    try {
      const teardownErrors = await withTimeout(scope.teardown(), TEARDOWN_TIMEOUT_MS, "Fixture teardown");
      for (const error of teardownErrors) fail(error);
    } catch (error) {
      fail(error);
    }

    if (errors.length > 0 && status === "passed") status = "failed";
    shared().running = undefined;
    this.#attemptErrors = undefined;
    const jev = this.#jevState?.jev;
    const usage = jev ? subtractUsage(jev.usage.totals(), usageBefore) : emptyUsage();
    return {
      retry,
      workerIndex: this.#workerIndex,
      status,
      startTime,
      duration: Date.now() - startTime,
      errors: errors.map((error) => serializeError(error, this.config.rootDir)),
      steps: steps.steps,
      annotations: info.annotations,
      attachments: info.attachments,
      outputDir: existsSync(info.outputDir) ? info.outputDir : undefined,
      ai: jev && (usage.calls > 0 || ai.decisions.length > 0) ? { provider: jev.provider, usage, decisions: ai.decisions } : undefined,
    };
  }

  #builtins(test: TestNode, ai: AiRuntime): FixtureLayer {
    const config = this.config;
    const testUse: UseOptions = Object.assign({}, config.use, ...ancestors(test).flatMap((suite) => suite.use));
    return {
      browser: {
        name: "browser",
        deps: [],
        fn: async (_: unknown, provide: (value: Browser) => Promise<void>) => provide(await this.browser()),
      },
      browserName: { name: "browserName", deps: [], value: config.browser },
      baseURL: { name: "baseURL", deps: [], value: config.baseURL },
      context: {
        name: "context",
        deps: ["browser"],
        fn: async (
          { browser }: { browser: Browser },
          provide: (value: BrowserContext) => Promise<void>,
          info: TestInfoImpl,
        ) => {
          const { actionTimeout, navigationTimeout, ...options } = testUse;
          const context = await browser.newContext({ ...options, baseURL: config.baseURL });
          context.setDefaultTimeout(actionTimeout ?? 0);
          context.setDefaultNavigationTimeout(navigationTimeout ?? 0);
          const recorder = new ArtifactRecorder(context);
          await context.tracing.start({ screenshots: true, snapshots: true, sources: true, title: info.titlePath.join(" › ") });
          await provide(context);
          await finishArtifacts(context, recorder, info);
          await context.close();
        },
      },
      page: {
        name: "page",
        deps: ["context"],
        fn: async ({ context }: { context: BrowserContext }, provide: (value: unknown) => Promise<void>) =>
          provide(await context.newPage()),
      },
      ai: {
        name: "ai",
        deps: ["page"],
        fn: async ({ page }: { page: Page }, provide: (value: unknown) => Promise<void>) => provide(createAi(page, ai)),
      },
    };
  }
}

async function launch(config: ResolvedConfig): Promise<Browser> {
  const type = { chromium, firefox, webkit }[config.browser];
  try {
    return await type.launch({ headless: config.headless, ...config.launchOptions });
  } catch (error) {
    if (error instanceof Error && /Executable doesn't exist/.test(error.message)) {
      throw new Error(
        `${config.browser} is not installed for this version of Intelliwright. Run: npx intelliwright install ${config.browser}`,
      );
    }
    throw error;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  if (ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}