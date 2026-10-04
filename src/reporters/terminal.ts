import path from "node:path";
import colors from "picocolors";
import type { AttemptResult, SerializedError } from "../runner/types.js";
import { formatDuration, plural, testLabel } from "./format.js";
import type { Reporter, RunInfo, RunSummary, TestCase } from "./types.js";

export class TerminalReporter implements Reporter {
  readonly #write: (text: string) => void;
  #rootDir = "";

  constructor(write: (text: string) => void = (text) => process.stdout.write(text)) {
    this.#write = write;
  }

  onBegin(run: RunInfo): void {
    this.#rootDir = run.config.rootDir;
    this.#write(`\nRunning ${plural(run.tests.length, "test")} using ${plural(run.workers, "worker")}\n\n`);
  }

  onTestEnd(test: TestCase, result: AttemptResult, willRetry: boolean): void {
    const duration = colors.dim(`(${formatDuration(result.duration)})`);
    const label = testLabel(test);
    let line: string;
    switch (result.status) {
      case "passed":
        line = result.retry > 0
          ? `${colors.yellow("✓")}  ${label} ${duration} ${colors.yellow(`flaky, passed on retry ${result.retry}`)}`
          : `${colors.green("✓")}  ${label} ${duration}`;
        break;
      case "skipped":
        line = `${colors.yellow("-")}  ${colors.dim(label)}`;
        break;
      default: {
        const what = result.status === "timedOut" ? "timed out" : "failed";
        const note = willRetry ? `${what}, retrying` : what;
        line = `${colors.red("✘")}  ${label} ${duration} ${colors.red(note)}`;
      }
    }
    this.#write(`  ${line}\n`);
  }

  onError(error: SerializedError): void {
    this.#write(`\n${colors.red("Error:")} ${error.message}\n`);
  }

  onEnd(summary: RunSummary): void {
    const failed = summary.tests.filter((test) => test.outcome === "failed");
    failed.forEach((test, index) => this.#printFailure(test, index + 1));

    const { counts } = summary;
    const lines: string[] = [];
    if (counts.passed) lines.push(colors.green(`${counts.passed} passed`));
    if (counts.failed) {
      lines.push(colors.red(`${counts.failed} failed`));
      for (const test of failed) lines.push(colors.red(`  ${testLabel(test)}`));
    }
    if (counts.flaky) {
      lines.push(colors.yellow(`${counts.flaky} flaky`));
      for (const test of summary.tests.filter((t) => t.outcome === "flaky")) lines.push(colors.yellow(`  ${testLabel(test)}`));
    }
    if (counts.skipped) lines.push(colors.yellow(`${counts.skipped} skipped`));
    if (summary.status === "interrupted") lines.push(colors.red("Interrupted"));
    lines.push(colors.dim(`Finished in ${formatDuration(summary.duration)}`));
    this.#write(`\n${lines.map((line) => `  ${line}`).join("\n")}\n\n`);
  }

  #printFailure(test: TestCase, index: number): void {
    const last = test.results.at(-1);
    this.#write(`\n  ${colors.red(`${index}) ${testLabel(test)}`)}\n`);
    for (const error of last?.errors ?? []) {
      this.#write(`\n${indent(error.message, 4)}\n`);
      if (error.location) {
        const where = path.relative(this.#rootDir, error.location.file) || error.location.file;
        this.#write(colors.dim(`\n    at ${where}:${error.location.line}:${error.location.column}\n`));
      }
    }
  }
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
