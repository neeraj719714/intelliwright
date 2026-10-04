import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../version.js";
import { stripAnsi } from "./format.js";
import type { Reporter, RunInfo, RunSummary } from "./types.js";

export interface JsonReporterOptions {
  /** Relative to the config folder. Defaults to `test-results/results.json`. */
  outputFile?: string;
}

/** Writes the whole run, every attempt included, as one JSON file. */
export class JsonReporter implements Reporter {
  readonly #options: JsonReporterOptions;
  #file = "";

  constructor(options: JsonReporterOptions = {}) {
    this.#options = options;
  }

  onBegin(run: RunInfo): void {
    this.#file = path.resolve(run.config.rootDir, this.#options.outputFile ?? path.join("test-results", "results.json"));
  }

  onEnd(summary: RunSummary): void {
    const stats = { total: summary.tests.length, ...summary.counts };
    const report = {
      version: VERSION,
      status: summary.status,
      startTime: new Date(summary.startTime).toISOString(),
      duration: summary.duration,
      stats,
      ai: summary.ai,
      notes: summary.notes,
      errors: summary.errors.map((error) => ({ ...error, message: stripAnsi(error.message) })),
      tests: summary.tests.map((test) => ({
        id: test.id,
        file: test.relFile,
        line: test.line,
        column: test.column,
        titlePath: test.titlePath,
        tags: test.tags,
        outcome: test.outcome ?? null,
        triage: test.triage,
        attempts: test.results.map((result) => ({
          ...result,
          errors: result.errors.map((error) => ({ ...error, message: stripAnsi(error.message) })),
        })),
      })),
    };
    mkdirSync(path.dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, `${JSON.stringify(report, null, 2)}\n`);
  }
}
