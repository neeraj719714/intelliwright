import { loadConfig } from "../config/load-config.js";
import type { ConfigOverrides, ResolvedConfig } from "../config/types.js";
import { TerminalReporter } from "../reporters/terminal.js";
import type { Counts, Outcome, Reporter, RunSummary, TestCase } from "../reporters/types.js";
import { collectFile } from "./collect-file.js";
import { discoverTestFiles } from "./discover.js";
import { importModule } from "./loader.js";
import { serializeError } from "./location.js";
import { WorkerPool } from "./pool.js";
import type { Job, WorkerMessage } from "./protocol.js";
import type { AttemptResult, SerializedError } from "./types.js";
import { startWebServers, type RunningServers } from "./web-server.js";

export interface RunOptions {
  cwd: string;
  configFile?: string;
  overrides: ConfigOverrides;
  /** The CLI entry file, forked for each worker. */
  workerEntry: string;
}

/** Runs the suite and returns the process exit code. */
export async function runTests(options: RunOptions): Promise<number> {
  process.setSourceMapsEnabled(true);
  const config = await loadConfig({ cwd: options.cwd, configFile: options.configFile, overrides: options.overrides });
  const reporters = createReporters(config);
  const { tests, errors } = await collectTests(config);
  const selected = focusOnly(tests);

  if (selected.length === 0) {
    for (const error of errors) emit(reporters, (reporter) => reporter.onError?.(error));
    process.stderr.write(errors.length > 0 ? "" : `No tests found in ${config.testDir}\n`);
    return 1;
  }
  return execute(config, selected, errors, reporters, options);
}

export async function collectTests(config: ResolvedConfig): Promise<{ tests: TestCase[]; errors: SerializedError[] }> {
  const tests: TestCase[] = [];
  const errors: SerializedError[] = [];
  for (const file of await discoverTestFiles(config)) {
    try {
      const collected = await collectFile(file, config.rootDir);
      for (const node of collected.tests) {
        tests.push({
          id: node.id,
          title: node.title,
          titlePath: node.titlePath,
          file: node.location.file,
          relFile: collected.relFile,
          line: node.location.line,
          column: node.location.column,
          tags: node.tags,
          skipped: node.skipped,
          skipReason: node.skipReason,
          annotations: node.annotations,
          only: node.only,
          results: [],
          outcome: undefined,
        });
      }
    } catch (error) {
      const serialized = serializeError(error, config.rootDir);
      errors.push({ ...serialized, message: `Couldn't load ${file}:\n${serialized.message}` });
    }
  }
  return { tests, errors };
}

/** With `.only` anywhere, only those tests run. */
function focusOnly(tests: TestCase[]): TestCase[] {
  const focused = tests.filter((test) => test.only);
  return focused.length > 0 ? focused : tests;
}

function createReporters(_config: ResolvedConfig): Reporter[] {
  return [new TerminalReporter()];
}

function emit(reporters: Reporter[], call: (reporter: Reporter) => void): void {
  for (const reporter of reporters) {
    try {
      call(reporter);
    } catch (error) {
      process.stderr.write(`Reporter error: ${String((error as Error)?.stack ?? error)}\n`);
    }
  }
}

async function execute(
  config: ResolvedConfig,
  tests: TestCase[],
  errors: SerializedError[],
  reporters: Reporter[],
  options: RunOptions,
): Promise<number> {
  const startTime = Date.now();
  const runnable = tests.filter((test) => !test.skipped);
  const jobs = jobsFor(runnable);
  const workers = Math.max(1, Math.min(config.workers, jobs.length));
  emit(reporters, (reporter) => reporter.onBegin?.({ config, tests, workers, startTime }));
  for (const error of errors) emit(reporters, (reporter) => reporter.onError?.(error));

  for (const test of tests.filter((t) => t.skipped)) {
    const result = skippedResult(test);
    test.results.push(result);
    test.outcome = "skipped";
    emit(reporters, (reporter) => reporter.onTestBegin?.(test, 0));
    emit(reporters, (reporter) => reporter.onTestEnd?.(test, result, false));
  }

  const byId = new Map(runnable.map((test) => [test.id, test]));
  const running = new Map<number, string>();
  const finish = (test: TestCase, result: AttemptResult, willRetry: boolean): void => {
    test.results.push(result);
    if (!willRetry) test.outcome = outcomeOf(test);
    emit(reporters, (reporter) => reporter.onTestEnd?.(test, result, willRetry));
  };
  const addError = (error: SerializedError): void => {
    errors.push(error);
    emit(reporters, (reporter) => reporter.onError?.(error));
  };

  const pool = new WorkerPool({
    workers,
    entry: options.workerEntry,
    cwd: config.rootDir,
    configFile: config.configFile,
    overrides: options.overrides,
    onMessage(workerIndex: number, message: WorkerMessage) {
      const test = "testId" in message ? byId.get(message.testId) : undefined;
      switch (message.type) {
        case "testBegin":
          running.set(workerIndex, message.testId);
          if (test) emit(reporters, (reporter) => reporter.onTestBegin?.(test, message.retry));
          break;
        case "stepEnd":
          if (test) emit(reporters, (reporter) => reporter.onStepEnd?.(test, message.retry, message.step));
          break;
        case "testEnd":
          running.delete(workerIndex);
          if (test) finish(test, message.result, message.willRetry);
          break;
        case "done":
          for (const error of message.errors) addError(error);
          break;
      }
    },
    onCrash(workerIndex: number, job: Job | undefined, reason: string) {
      const crashedId = running.get(workerIndex);
      running.delete(workerIndex);
      if (!job) return;
      const unfinished = job.testIds.filter((id) => byId.get(id)?.outcome === undefined);
      for (const id of unfinished.filter((testId) => testId === crashedId || crashedId === undefined)) {
        const test = byId.get(id)!;
        finish(test, failedResult(workerIndex, reason), false);
      }
      const rest = unfinished.filter((id) => byId.get(id)?.outcome === undefined);
      if (rest.length > 0) pool.requeue({ file: job.file, testIds: rest });
    },
    onFatal(error: SerializedError, abandoned: Job[]) {
      addError(error);
      for (const job of abandoned) {
        for (const id of job.testIds) {
          const test = byId.get(id);
          if (test && test.outcome === undefined) finish(test, failedResult(-1, `Not run: ${error.message}`), false);
        }
      }
    },
  });

  let interrupted = false;
  const onInterrupt = (): void => {
    interrupted = true;
    pool.stop();
  };
  let servers: RunningServers | undefined;
  let teardown: (() => Promise<void>) | undefined;
  try {
    if (runnable.length > 0) {
      servers = await startWebServers(config.webServer, config.rootDir, options.overrides.baseURL);
      teardown = await runGlobalSetup(config);
      process.once("SIGINT", onInterrupt);
      await pool.run(jobs);
    }
  } catch (error) {
    addError(serializeError(error, config.rootDir));
  } finally {
    process.off("SIGINT", onInterrupt);
    try {
      await teardown?.();
    } catch (error) {
      addError(serializeError(error, config.rootDir));
    }
    await servers?.stop();
  }

  const counts = countOutcomes(tests);
  const status: RunSummary["status"] = interrupted
    ? "interrupted"
    : counts.failed > 0 || errors.length > 0 || tests.some((test) => test.outcome === undefined)
      ? "failed"
      : "passed";
  const summary: RunSummary = { status, startTime, duration: Date.now() - startTime, tests, errors, counts };
  for (const reporter of reporters) {
    try {
      await reporter.onEnd?.(summary);
    } catch (error) {
      process.stderr.write(`Reporter error: ${String((error as Error)?.stack ?? error)}\n`);
    }
  }
  return status === "passed" ? 0 : status === "interrupted" ? 130 : 1;
}

async function runGlobalSetup(config: ResolvedConfig): Promise<() => Promise<void>> {
  let returnedTeardown: unknown;
  if (config.globalSetup) {
    returnedTeardown = await callDefault(config.globalSetup, config, "globalSetup");
  }
  return async () => {
    if (typeof returnedTeardown === "function") await returnedTeardown();
    if (config.globalTeardown) await callDefault(config.globalTeardown, config, "globalTeardown");
  };
}

async function callDefault(file: string, config: ResolvedConfig, what: string): Promise<unknown> {
  const loaded = (await importModule(file)) as { default?: unknown } | undefined;
  const fn = loaded?.default ?? loaded;
  if (typeof fn !== "function") throw new Error(`${what} (${file}) must export a function as its default export.`);
  return fn(config);
}

function jobsFor(tests: TestCase[]): Job[] {
  const jobs = new Map<string, Job>();
  for (const test of tests) {
    const job = jobs.get(test.file) ?? { file: test.file, testIds: [] };
    job.testIds.push(test.id);
    jobs.set(test.file, job);
  }
  return [...jobs.values()];
}

function outcomeOf(test: TestCase): Outcome {
  const last = test.results.at(-1);
  if (!last || last.status === "skipped") return "skipped";
  if (last.status === "passed") return test.results.length > 1 ? "flaky" : "passed";
  return "failed";
}

export function countOutcomes(tests: TestCase[]): Counts {
  const counts: Counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const test of tests) if (test.outcome) counts[test.outcome]++;
  return counts;
}

function skippedResult(test: TestCase): AttemptResult {
  return {
    retry: 0,
    workerIndex: -1,
    status: "skipped",
    startTime: Date.now(),
    duration: 0,
    errors: [],
    steps: [],
    annotations: [...test.annotations, ...(test.skipReason ? [{ type: "skip", description: test.skipReason }] : [])],
    attachments: [],
  };
}

function failedResult(workerIndex: number, message: string): AttemptResult {
  return {
    retry: 0,
    workerIndex,
    status: "failed",
    startTime: Date.now(),
    duration: 0,
    errors: [{ message }],
    steps: [],
    annotations: [],
    attachments: [],
  };
}
