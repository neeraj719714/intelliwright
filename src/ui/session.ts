import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { ConfigOverrides, ResolvedConfig } from "../config/types.js";
import { cleanError, reportAttempt, reportStep, reportTest, type LinkFile, type ReportTest } from "../reporters/html/data.js";
import type { Reporter, RunSummary, TestCase } from "../reporters/types.js";
import { authStatePath } from "../runner/auth.js";
import { forgetModules } from "../runner/loader.js";
import { serializeError } from "../runner/location.js";
import { collectTests, missingSignIns, runSelection, signInRoles, startEnvironment, type Environment } from "../runner/run.js";
import { readLastRun, selectTests, type LastRun, type SelectionOptions } from "../runner/select.js";
import type { SerializedError } from "../runner/types.js";
import { VERSION } from "../version.js";
import { applyEvent, countTests, type UiEvent, type UiState } from "./state.js";

/** How long the test folder must be quiet before the list reloads. */
const RELOAD_DELAY_MS = 150;

export interface UiSessionOptions {
  cwd: string;
  configFile?: string;
  overrides: ConfigOverrides;
  selection: SelectionOptions;
  /** The CLI entry file, forked for each worker. */
  workerEntry: string;
}

/** `busy` while another run is in progress, `unknown` when none of the ids are listed. */
export type RunRequest = "started" | "busy" | "unknown";

/**
 * The test list and the latest results for UI mode. The web servers and global
 * setup start once and keep running until `close()`. Changes in the test folder
 * reload the list, and runs reuse the sign-ins this session already saved.
 */
export class UiSession {
  readonly config: ResolvedConfig;
  readonly #options: UiSessionOptions;
  readonly #startedAt = Date.now();
  /** Read once, so `--last-failed` keeps listing the same tests as they start to pass. */
  readonly #lastRun: LastRun | null | undefined;
  readonly #listeners = new Set<(event: UiEvent) => void>();
  #environment: Environment | undefined;
  #watcher: FSWatcher | undefined;
  /** Every collected test, before the selection. */
  #all: TestCase[] = [];
  #tests: TestCase[] = [];
  #setups: TestCase[] = [];
  #loadErrors: SerializedError[] = [];
  #runErrors: SerializedError[] = [];
  #note: string | undefined;
  #runNotes: string[] = [];
  #state: UiState = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    status: "ready",
    startTime: 0,
    duration: 0,
    counts: countTests([]),
    errors: [],
    notes: [],
    tests: [],
  };
  #run: Promise<void> | undefined;
  #abort: AbortController | undefined;
  #reloading: Promise<void> | undefined;
  #reloadQueued = false;
  #reloadTimer: NodeJS.Timeout | undefined;
  #closed = false;

  private constructor(config: ResolvedConfig, options: UiSessionOptions) {
    this.config = config;
    this.#options = options;
    this.#lastRun = options.selection.lastFailed ? (readLastRun(config.outputDir) ?? null) : undefined;
  }

  /** Loads the config and the tests, then starts the web servers and global setup. */
  static async start(options: UiSessionOptions): Promise<UiSession> {
    const config = await loadConfig({ cwd: options.cwd, configFile: options.configFile, overrides: options.overrides });
    const session = new UiSession(config, options);
    await session.#collect();
    session.#environment = await startEnvironment(config, options.overrides);
    session.#watch();
    return session;
  }

  get state(): UiState {
    return this.#state;
  }

  subscribe(listener: (event: UiEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts a run of the listed tests with these ids, plus the sign-ins they need. */
  run(testIds: string[]): RunRequest {
    if (this.#run || this.#closed) return "busy";
    const requested = new Set(testIds);
    if (!this.#state.tests.some((test) => requested.has(test.id))) return "unknown";
    const controller = new AbortController();
    this.#abort = controller;
    this.#run = this.#execute(requested, controller.signal)
      .catch((error: unknown) => this.#addError(serializeError(error, this.config.rootDir)))
      .finally(() => {
        this.#run = undefined;
        this.#abort = undefined;
        if (this.#reloadQueued) {
          this.#reloadQueued = false;
          this.#requestReload();
        }
      });
    return "started";
  }

  /** Stops the run in progress, and returns false when there is none. */
  stop(): boolean {
    if (!this.#abort) return false;
    this.#abort.abort();
    return true;
  }

  /** Stops watching and any run, then runs the global teardown and stops the web servers. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#reloadTimer);
    this.#watcher?.close();
    this.#abort?.abort();
    await this.#run;
    await this.#reloading;
    this.#listeners.clear();
    await this.#environment?.stop();
  }

  async #execute(requested: Set<string>, signal: AbortSignal): Promise<void> {
    await this.#reloading;
    const { config } = this;
    const tests = this.#tests.filter((test) => requested.has(test.id)).map(fresh);
    const signIns = new Map(this.#setups.filter((setup) => requested.has(setup.id)).map((setup) => [setup.authSetup!, setup]));
    const roles = signInRoles(tests);
    const signedIn = new Set<string>();
    for (const role of roles) {
      const setup = this.#setups.find((item) => item.authSetup === role);
      if (!setup || signIns.has(role)) continue;
      if (this.#isSignedIn(setup)) signedIn.add(role);
      else signIns.set(role, setup);
    }
    const missing = missingSignIns(roles, this.#setups);
    const ids = new Set([...[...signIns.values()].map((setup) => setup.id), ...tests.map((test) => test.id)]);

    const before = new Map(this.#state.tests.map((test) => [test.id, test]));
    const startTime = Date.now();
    this.#runErrors = [];
    this.#runNotes = [];
    const queued = this.#state.tests.map((test): ReportTest =>
      ids.has(test.id) ? { ...test, outcome: "queued", duration: 0, triage: undefined, attempts: [] } : test,
    );
    this.#state = {
      ...this.#state,
      status: "running",
      startTime,
      duration: 0,
      ai: undefined,
      notes: this.#notes(),
      errors: [...this.#loadErrors],
      tests: queued,
      counts: countTests(queued),
    };
    this.#broadcast({ type: "tests", state: this.#state });
    this.#broadcast({ type: "run", status: "running", startTime, duration: 0, notes: this.#state.notes });

    let summary: RunSummary | undefined;
    try {
      summary = await runSelection({
        config,
        tests,
        signIns: [...signIns.values()].map(fresh),
        signedIn,
        errors: missing ? [missing] : [],
        reporters: [this.#reporter()],
        workerEntry: this.#options.workerEntry,
        overrides: this.#options.overrides,
        startEnvironment: false,
        signal,
        lastRun: "merge",
      });
    } catch (error) {
      this.#addError(serializeError(error, config.rootDir));
    }

    // Tests the run didn't finish, because it was stopped, go back to what they showed before it.
    const shown = this.#state.tests.map((test) =>
      test.outcome === "queued" || test.outcome === "running" ? (before.get(test.id) ?? test) : test,
    );
    const status = summary?.status ?? "failed";
    const duration = summary?.duration ?? Date.now() - startTime;
    this.#runNotes = summary?.notes ?? [];
    this.#state = { ...this.#state, status, duration, ai: summary?.ai, notes: this.#notes(), tests: shown, counts: countTests(shown) };
    this.#broadcast({ type: "tests", state: this.#state });
    this.#broadcast({ type: "run", status, startTime, duration, ai: summary?.ai, notes: this.#state.notes });
  }

  #reporter(): Reporter {
    const { rootDir } = this.config;
    return {
      onTestBegin: (test, retry) => this.#emit({ type: "testBegin", testId: test.id, retry, startTime: Date.now() }),
      onStepEnd: (test, retry, step) => this.#emit({ type: "step", testId: test.id, retry, step: reportStep(step, rootDir) }),
      onTestEnd: (test, result, willRetry) =>
        this.#emit({
          type: "testEnd",
          testId: test.id,
          attempt: reportAttempt(result, rootDir, this.#link(result.startTime)),
          ...(willRetry ? {} : { outcome: test.outcome, triage: test.triage }),
        }),
      onError: (error) => this.#addError(error),
    };
  }

  /** Files under `outputDir` load from `/artifacts/`, with the attempt's start time so a rerun's files aren't cached. */
  #link(version: number): LinkFile {
    const { outputDir } = this.config;
    return (file) => {
      const relative = path.relative(outputDir, file);
      if (!existsSync(file) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
      return `/artifacts/${relative.split(path.sep).map(encodeURIComponent).join("/")}?v=${version}`;
    };
  }

  #addError(error: SerializedError): void {
    const cleaned = cleanError(error, this.config.rootDir);
    this.#runErrors.push(cleaned);
    this.#emit({ type: "error", error: cleaned });
  }

  #emit(event: UiEvent): void {
    this.#state = applyEvent(this.#state, event);
    this.#broadcast(event);
  }

  #broadcast(event: UiEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  #notes(): string[] {
    return [...(this.#note ? [this.#note] : []), ...this.#runNotes];
  }

  /**
   * A role's saved state is reused when this session saved it, after its setup
   * file last changed. The first run that needs a role signs in again.
   */
  #isSignedIn(setup: TestCase): boolean {
    const saved = statSync(authStatePath(this.config.rootDir, setup.authSetup!), { throwIfNoEntry: false });
    if (!saved) return false;
    const source = statSync(setup.file, { throwIfNoEntry: false });
    return saved.mtimeMs >= this.#startedAt && saved.mtimeMs >= (source?.mtimeMs ?? 0);
  }

  /** Collects the tests again. A file that fails to load keeps the tests it had, next to its error. */
  async #collect(): Promise<void> {
    const { config } = this;
    forgetModules(config.rootDir);
    const collected = await collectTests(config);
    const failed = new Set(collected.failedFiles);
    const kept = (tests: TestCase[]): TestCase[] => tests.filter((test) => failed.has(test.file));
    const all = byFile([...collected.tests, ...kept(this.#all)]);
    const setups = byFile([
      ...collected.setups,
      ...kept(this.#setups).filter((setup) => !collected.setups.some((other) => other.authSetup === setup.authSetup)),
    ]);
    const { tests, note } = selectTests(all, this.#options.selection, {
      cwd: this.#options.cwd,
      suites: config.suites,
      outputDir: config.outputDir,
      lastRun: this.#lastRun,
    });
    this.#all = all;
    this.#setups = setups;
    this.#tests = tests;
    this.#note = note;
    this.#loadErrors = collected.errors.map((error) => cleanError(error, config.rootDir));
    this.#rebuild();
  }

  /** Lists the selected tests, after the sign-ins they need, with the results they had. */
  #rebuild(): void {
    const roles = signInRoles(this.#tests);
    const listed = [...this.#setups.filter((setup) => roles.includes(setup.authSetup!)), ...this.#tests];
    const previous = new Map(this.#state.tests.map((test) => [test.id, test]));
    const tests = listed.map((test): ReportTest => {
      const shown = reportTest(test, this.config.rootDir, () => undefined);
      const last = previous.get(test.id);
      return last ? { ...shown, outcome: last.outcome, duration: last.duration, triage: last.triage, attempts: last.attempts } : shown;
    });
    this.#state = {
      ...this.#state,
      tests,
      counts: countTests(tests),
      errors: [...this.#loadErrors, ...this.#runErrors],
      notes: this.#notes(),
    };
  }

  #watch(): void {
    const { testDir } = this.config;
    if (!existsSync(testDir)) return;
    try {
      this.#watcher = watch(testDir, { recursive: true }, (_event, filename) => {
        if (filename && this.#ignored(path.join(testDir, filename))) return;
        clearTimeout(this.#reloadTimer);
        this.#reloadTimer = setTimeout(() => this.#requestReload(), RELOAD_DELAY_MS);
      });
      this.#watcher.on("error", () => {});
    } catch (error) {
      process.stderr.write(`Couldn't watch ${testDir} for changes: ${(error as Error).message}\n`);
    }
  }

  #ignored(file: string): boolean {
    if (file.startsWith(this.config.outputDir + path.sep)) return true;
    return path
      .relative(this.config.testDir, file)
      .split(path.sep)
      .some((part) => part === "node_modules" || part.startsWith("."));
  }

  /** Reloads now, or once the run or reload in progress is over. */
  #requestReload(): void {
    if (this.#closed) return;
    if (this.#run || this.#reloading) {
      this.#reloadQueued = true;
      return;
    }
    this.#reloading = this.#reload().finally(() => {
      this.#reloading = undefined;
      if (this.#reloadQueued && !this.#run) {
        this.#reloadQueued = false;
        this.#requestReload();
      }
    });
  }

  async #reload(): Promise<void> {
    try {
      await this.#collect();
    } catch (error) {
      this.#loadErrors = [cleanError(serializeError(error, this.config.rootDir), this.config.rootDir)];
      this.#rebuild();
    }
    this.#broadcast({ type: "tests", state: this.#state });
  }
}

/** A copy for one run, since a run records its results on the tests it gets. */
function fresh(test: TestCase): TestCase {
  return { ...test, results: [], outcome: undefined, triage: undefined };
}

/** Sorted by file, keeping the order within each file. */
function byFile(tests: TestCase[]): TestCase[] {
  return [...tests].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
