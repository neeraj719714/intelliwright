import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { ConfigOverrides, ResolvedConfig, UseOptions } from "../config/types.js";
import { plural, testLabel } from "../reporters/format.js";
import { HtmlReporter, type HtmlReporterOptions } from "../reporters/html/index.js";
import { JsonReporter, type JsonReporterOptions } from "../reporters/json.js";
import { JunitReporter, type JunitReporterOptions } from "../reporters/junit.js";
import { TerminalReporter } from "../reporters/terminal.js";
import type { AiRunSummary, Counts, Outcome, Reporter, RunSummary, TestCase } from "../reporters/types.js";
import { addUsage, emptyUsage } from "../ai/usage.js";
import { checkRole, discoverSetupFiles } from "./auth.js";
import { collectFile } from "./collect-file.js";
import { LAST_RUN_FILE, mergeLastRun, readLastRun, selectTests, writeLastRun, type SelectionOptions } from "./select.js";
import { ancestors, type TestNode } from "./tree.js";
import { discoverTestFiles } from "./discover.js";
import { importModule } from "./loader.js";
import { serializeError } from "./location.js";
import { WorkerPool } from "./pool.js";
import type { Job, WorkerMessage } from "./protocol.js";
import type { AttemptResult, SerializedError } from "./types.js";
import { startWebServers } from "./web-server.js";

export interface RunOptions {
  cwd: string;
  configFile?: string;
  overrides: ConfigOverrides;
  selection?: SelectionOptions;
  /** Print the selected tests instead of running them. */
  list?: boolean;
  /** The CLI entry file, forked for each worker. */
  workerEntry: string;
}

/** Runs the suite and returns the process exit code. */
export async function runTests(options: RunOptions): Promise<number> {
  process.setSourceMapsEnabled(true);
  const config = await loadConfig({ cwd: options.cwd, configFile: options.configFile, overrides: options.overrides });
  const { tests, setups, errors } = await collectTests(config);
  const { tests: selected, note } = selectTests(tests, options.selection ?? {}, {
    cwd: options.cwd,
    suites: config.suites,
    outputDir: config.outputDir,
  });
  const roles = signInRoles(selected);
  const missing = missingSignIns(roles, setups);
  if (missing) errors.push(missing);

  if (options.list) return printList(selected, roles, errors, note);

  const reporters = createReporters(config);
  if (selected.length === 0) {
    for (const error of errors) emit(reporters, (reporter) => reporter.onError?.(error));
    if (note && errors.length === 0) {
      process.stdout.write(`${note}\n`);
      return 0;
    }
    if (errors.length === 0) {
      process.stderr.write(tests.length === 0 ? `No tests found in ${config.testDir}\n` : "No tests match the filters.\n");
    }
    return 1;
  }
  const signIns = setups.filter((setup) => roles.includes(setup.authSetup!));
  clearOutputDir(config);
  const summary = await runSelection({
    config,
    tests: selected,
    signIns,
    errors,
    reporters,
    workerEntry: options.workerEntry,
    overrides: options.overrides,
  });
  return summary.status === "passed" ? 0 : summary.status === "interrupted" ? 130 : 1;
}

/** The roles the tests start signed in as, sorted. */
export function signInRoles(tests: TestCase[]): string[] {
  return [...new Set(tests.flatMap((test) => (!test.skipped && test.auth ? [test.auth] : [])))].sort();
}

/** The error for roles that no setup file signs in as, if there are any. */
export function missingSignIns(roles: string[], setups: TestCase[]): SerializedError | undefined {
  const missing = roles.filter((role) => !setups.some((setup) => setup.authSetup === role));
  if (missing.length === 0) return undefined;
  return {
    message: `No sign-in for ${missing.map((role) => `"${role}"`).join(", ")}. Add test.auth("${missing[0]}", async ({ page }) => { ... }) to a setup file such as e2e/auth.setup.ts.`,
  };
}

function printList(tests: TestCase[], roles: string[], errors: SerializedError[], note: string | undefined): number {
  for (const error of errors) process.stderr.write(`Error: ${error.message}\n`);
  const lines = tests.map((test) => {
    const label = testLabel(test);
    const extraTags = test.tags.filter((tag) => !test.titlePath.some((title) => title.includes(tag)));
    return `  ${label}${extraTags.length ? ` ${extraTags.join(" ")}` : ""}`;
  });
  const files = new Set(tests.map((test) => test.file)).size;
  process.stdout.write(
    `Listing tests:\n${lines.join("\n")}${lines.length ? "\n" : ""}Total: ${plural(tests.length, "test")} in ${plural(files, "file")}\n`,
  );
  if (roles.length > 0) process.stdout.write(`Signs in first as: ${roles.join(", ")}\n`);
  if (note) process.stdout.write(`${note}\n`);
  return errors.length > 0 ? 1 : 0;
}

export interface CollectedTests {
  tests: TestCase[];
  /** Sign-ins from `test.auth()` in setup files, one per role. */
  setups: TestCase[];
  errors: SerializedError[];
  /** Files that threw while loading. */
  failedFiles: string[];
}

export async function collectTests(config: ResolvedConfig): Promise<CollectedTests> {
  const tests: TestCase[] = [];
  const setups: TestCase[] = [];
  const errors: SerializedError[] = [];
  const failedFiles: string[] = [];
  const load = async (file: string, into: TestCase[]): Promise<void> => {
    try {
      const collected = await collectFile(file, config.rootDir);
      for (const node of collected.tests) into.push(toTestCase(node, collected.relFile, config));
    } catch (error) {
      const serialized = serializeError(error, config.rootDir);
      errors.push({ ...serialized, message: `Couldn't load ${file}:\n${serialized.message}` });
      failedFiles.push(file);
    }
  };
  for (const file of await discoverTestFiles(config)) await load(file, tests);
  for (const file of await discoverSetupFiles(config)) await load(file, setups);

  const byRole = new Map<string, TestCase>();
  for (const setup of setups) {
    const first = byRole.get(setup.authSetup!);
    if (first) {
      errors.push({
        message: `There are two sign-ins for "${setup.authSetup}": ${first.relFile}:${first.line} and ${setup.relFile}:${setup.line}. Keep one.`,
      });
    } else {
      byRole.set(setup.authSetup!, setup);
    }
  }
  return { tests, setups: [...byRole.values()], errors, failedFiles };
}

function toTestCase(node: TestNode, relFile: string, config: ResolvedConfig): TestCase {
  const use: UseOptions = Object.assign({}, config.use, ...ancestors(node).flatMap((suite) => suite.use));
  const auth = node.authSetup || use.auth == null ? undefined : checkRole(use.auth, `use.auth for "${node.title}"`);
  return {
    id: node.id,
    title: node.title,
    titlePath: node.titlePath,
    file: node.location.file,
    relFile,
    line: node.location.line,
    column: node.location.column,
    describeLines: ancestors(node).flatMap((suite) => (suite.location ? [suite.location.line] : [])),
    tags: node.tags,
    skipped: node.skipped,
    skipReason: node.skipReason,
    annotations: node.annotations,
    only: node.only,
    results: [],
    outcome: undefined,
    ...(auth ? { auth } : {}),
    ...(node.authSetup ? { authSetup: node.authSetup } : {}),
  };
}

function createReporters(config: ResolvedConfig): Reporter[] {
  return config.reporters.map(([name, options]) => {
    switch (name) {
      case "terminal":
        return new TerminalReporter();
      case "html":
        return new HtmlReporter(options as HtmlReporterOptions);
      case "json":
        return new JsonReporter(options as JsonReporterOptions);
      case "junit":
        return new JunitReporter(options as JunitReporterOptions);
    }
  });
}

/** Clears the previous run's artifacts, but only from a folder inside the project. */
function clearOutputDir(config: ResolvedConfig): void {
  if (!config.outputDir.startsWith(config.rootDir + path.sep)) return;
  for (const entry of existsSync(config.outputDir) ? readdirSync(config.outputDir) : []) {
    if (entry === LAST_RUN_FILE) continue;
    rmSync(path.join(config.outputDir, entry), { recursive: true, force: true });
  }
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

export interface SelectionRun {
  config: ResolvedConfig;
  /** The tests to run, in order, with no results yet. */
  tests: TestCase[];
  /** Sign-ins that run before the tests, one per role. */
  signIns: TestCase[];
  /** Roles whose state an earlier run saved, so their tests start signed in without signing in again. */
  signedIn?: ReadonlySet<string>;
  /** Problems found before the run, such as a test file that failed to load. */
  errors: SerializedError[];
  reporters: Reporter[];
  /** The CLI entry file, forked for each worker. */
  workerEntry: string;
  overrides: ConfigOverrides;
  /**
   * Starts webServer and globalSetup before the first test and stops them after
   * the run. Defaults to true. UI mode starts them once and passes false.
   */
  startEnvironment?: boolean;
  /** Stops the run when aborted. Without one, Ctrl+C stops it. */
  signal?: AbortSignal;
  /**
   * `merge` keeps the earlier failures of tests this run didn't finish, for UI
   * mode, whose runs each cover a few tests. Defaults to `replace`.
   */
  lastRun?: "replace" | "merge";
}

export interface Environment {
  /** Runs the global teardown, then stops the web servers. */
  stop(): Promise<void>;
}

/** Starts the webServer entries, then runs globalSetup. */
export async function startEnvironment(config: ResolvedConfig, overrides: ConfigOverrides): Promise<Environment> {
  const servers = await startWebServers(config.webServer, config.rootDir, overrides.baseURL);
  let teardown: () => Promise<void>;
  try {
    teardown = await runGlobalSetup(config);
  } catch (error) {
    await servers.stop();
    throw error;
  }
  return {
    async stop() {
      try {
        await teardown();
      } finally {
        await servers.stop();
      }
    },
  };
}

/** Runs the sign-ins, then the tests, on a pool of workers, and reports both. */
export async function runSelection(run: SelectionRun): Promise<RunSummary> {
  const { config, signIns, errors, reporters } = run;
  const selected = run.tests;
  const startTime = Date.now();
  const tests = [...signIns, ...selected];
  const runnable = selected.filter((test) => !test.skipped);
  const workers = Math.max(1, Math.min(config.workers, Math.max(jobsFor(runnable).length, jobsFor(signIns).length)));
  emit(reporters, (reporter) => reporter.onBegin?.({ config, tests, workers, startTime }));
  for (const error of errors) emit(reporters, (reporter) => reporter.onError?.(error));

  const skip = (test: TestCase, reason?: string): void => {
    const result = skippedResult(test, reason);
    test.results.push(result);
    test.outcome = "skipped";
    emit(reporters, (reporter) => reporter.onTestBegin?.(test, 0));
    emit(reporters, (reporter) => reporter.onTestEnd?.(test, result, false));
  };
  for (const test of selected.filter((t) => t.skipped)) skip(test);

  // Tests whose role has no sign-in, or whose sign-in failed, can't start signed in.
  const blocked = new Set<TestCase>();
  const block = (roles: Set<string>, reason: (role: string) => string): void => {
    for (const test of runnable) {
      if (!test.auth || !roles.has(test.auth) || blocked.has(test)) continue;
      blocked.add(test);
      skip(test, reason(test.auth));
    }
  };
  const available = new Set([...signIns.map((setup) => setup.authSetup!), ...(run.signedIn ?? [])]);
  block(new Set(runnable.flatMap((test) => (test.auth && !available.has(test.auth) ? [test.auth] : []))), (role) => `No sign-in for "${role}".`);

  const byId = new Map([...signIns, ...runnable].map((test) => [test.id, test]));
  const running = new Map<number, string>();
  let interrupted = false;
  const finish = (test: TestCase, result: AttemptResult, willRetry: boolean): void => {
    test.results.push(result);
    if (!willRetry) {
      test.outcome = outcomeOf(test);
      test.triage =
        result.triage ??
        (test.outcome === "flaky" ? { label: "flaky", note: `Failed, then passed on retry ${result.retry}.` } : undefined);
    }
    emit(reporters, (reporter) => reporter.onTestEnd?.(test, result, willRetry));
  };
  const addError = (error: SerializedError): void => {
    errors.push(error);
    emit(reporters, (reporter) => reporter.onError?.(error));
  };

  const pool = new WorkerPool({
    workers,
    entry: run.workerEntry,
    cwd: config.rootDir,
    configFile: config.configFile,
    overrides: run.overrides,
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
      // Stopping the run kills the workers; their tests are left unfinished, not failed.
      if (!job || interrupted) return;
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

  const onInterrupt = (): void => {
    interrupted = true;
    pool.stop();
  };
  let environment: Environment | undefined;
  try {
    if (runnable.length > blocked.size || signIns.length > 0) {
      if (run.startEnvironment ?? true) environment = await startEnvironment(config, run.overrides);
      if (!run.signal) process.once("SIGINT", onInterrupt);
      else if (run.signal.aborted) onInterrupt();
      else run.signal.addEventListener("abort", onInterrupt, { once: true });
      if (signIns.length > 0 && !interrupted) {
        await pool.run(jobsFor(signIns));
        const failed = signIns.filter((setup) => setup.outcome !== "passed" && setup.outcome !== "flaky");
        if (!interrupted) block(new Set(failed.map((setup) => setup.authSetup!)), (role) => `Signing in as "${role}" failed.`);
      }
      const ready = runnable.filter((test) => test.outcome === undefined && !blocked.has(test));
      if (!interrupted && ready.length > 0) await pool.run(jobsFor(ready));
    }
  } catch (error) {
    addError(serializeError(error, config.rootDir));
  } finally {
    process.off("SIGINT", onInterrupt);
    run.signal?.removeEventListener("abort", onInterrupt);
    try {
      await environment?.stop();
    } catch (error) {
      addError(serializeError(error, config.rootDir));
    }
  }

  const counts = countOutcomes(tests);
  const status: RunSummary["status"] = interrupted
    ? "interrupted"
    : counts.failed > 0 || errors.length > 0 || tests.some((test) => test.outcome === undefined)
      ? "failed"
      : "passed";
  const summary: RunSummary = {
    status,
    startTime,
    duration: Date.now() - startTime,
    tests,
    errors,
    counts,
    ai: aiSummary(tests),
    notes: [...new Set(tests.flatMap((test) => test.results.at(-1)?.triageSkipped ?? []))],
  };
  try {
    const failedTests = selected.filter((test) => test.outcome === "failed" || blocked.has(test)).map((test) => test.id);
    const finished = selected.filter((test) => test.outcome !== undefined).map((test) => test.id);
    writeLastRun(
      config.outputDir,
      run.lastRun === "merge"
        ? mergeLastRun(readLastRun(config.outputDir), { status, finished, failedTests })
        : { status, failedTests },
    );
  } catch (error) {
    process.stderr.write(`Couldn't save the run state: ${(error as Error).message}\n`);
  }
  for (const reporter of reporters) {
    try {
      await reporter.onEnd?.(summary);
    } catch (error) {
      process.stderr.write(`Reporter error: ${String((error as Error)?.stack ?? error)}\n`);
    }
  }
  return summary;
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

/** Jev usage summed over every attempt that used it. */
export function aiSummary(tests: TestCase[]): AiRunSummary | undefined {
  let provider: string | undefined;
  let usage = emptyUsage();
  for (const test of tests) {
    for (const result of test.results) {
      if (!result.ai) continue;
      provider ??= result.ai.provider;
      usage = addUsage(usage, result.ai.usage);
    }
  }
  return provider ? { provider, usage } : undefined;
}

export function countOutcomes(tests: TestCase[]): Counts {
  const counts: Counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const test of tests) if (test.outcome) counts[test.outcome]++;
  return counts;
}

function skippedResult(test: TestCase, reason = test.skipReason): AttemptResult {
  return {
    retry: 0,
    workerIndex: -1,
    status: "skipped",
    startTime: Date.now(),
    duration: 0,
    errors: [],
    steps: [],
    annotations: [...test.annotations, ...(reason ? [{ type: "skip", description: reason }] : [])],
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
