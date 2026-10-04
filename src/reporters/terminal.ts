import { readFileSync } from "node:fs";
import path from "node:path";
import { codeFrameColumns } from "@babel/code-frame";
import { createColors } from "picocolors";
import type { AttemptResult, SerializedError } from "../runner/types.js";
import { formatCost, formatDuration, plural, testLabel } from "./format.js";
import type { Reporter, RunInfo, RunSummary, TestCase } from "./types.js";

type Colors = ReturnType<typeof createColors>;

export interface TerminalReporterOptions {
  write?: (text: string) => void;
  colors?: boolean;
}

/** Colors only on a terminal, never with NO_COLOR, always with FORCE_COLOR. */
export function shouldColor(stream: { isTTY?: boolean } = process.stdout): boolean {
  if ("NO_COLOR" in process.env) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) return force !== "0" && force !== "false";
  return Boolean(stream.isTTY);
}

export class TerminalReporter implements Reporter {
  readonly #write: (text: string) => void;
  readonly #c: Colors;
  #rootDir = process.cwd();

  constructor(options: TerminalReporterOptions = {}) {
    this.#write = options.write ?? ((text) => process.stdout.write(text));
    this.#c = createColors(options.colors ?? shouldColor());
  }

  onBegin(run: RunInfo): void {
    this.#rootDir = run.config.rootDir;
    this.#write(`\nRunning ${plural(run.tests.length, "test")} using ${plural(run.workers, "worker")}\n\n`);
  }

  onTestEnd(test: TestCase, result: AttemptResult, willRetry: boolean): void {
    const c = this.#c;
    const duration = c.dim(`(${formatDuration(result.duration)})`);
    const label = testLabel(test);
    let line: string;
    switch (result.status) {
      case "passed":
        line =
          result.retry > 0
            ? `${c.yellow("✓")}  ${label} ${duration} ${c.yellow(`flaky, passed on retry ${result.retry}`)}`
            : `${c.green("✓")}  ${label} ${duration}`;
        break;
      case "skipped":
        line = `${c.yellow("-")}  ${c.dim(label)}`;
        break;
      default: {
        const what = result.status === "timedOut" ? "timed out" : "failed";
        line = `${c.red("✘")}  ${label} ${duration} ${c.red(willRetry ? `${what}, retrying` : what)}`;
      }
    }
    this.#write(`  ${line}\n`);
  }

  onError(error: SerializedError): void {
    this.#write(`\n${this.#c.red("Error:")} ${error.message}\n`);
  }

  onEnd(summary: RunSummary): void {
    const c = this.#c;
    const failed = summary.tests.filter((test) => test.outcome === "failed");
    failed.forEach((test, index) => this.#printFailure(test, index + 1));

    const { counts } = summary;
    const lines: string[] = [];
    if (counts.passed) lines.push(c.green(`${counts.passed} passed`));
    if (counts.failed) {
      lines.push(c.red(`${counts.failed} failed`));
      for (const test of failed) lines.push(c.red(`  ${testLabel(test)}`));
    }
    if (counts.flaky) {
      lines.push(c.yellow(`${counts.flaky} flaky`));
      for (const test of summary.tests.filter((t) => t.outcome === "flaky")) lines.push(c.yellow(`  ${testLabel(test)}`));
    }
    if (counts.skipped) lines.push(c.yellow(`${counts.skipped} skipped`));
    if (summary.status === "interrupted") lines.push(c.red("Interrupted"));
    this.#write(`\n${lines.map((line) => `  ${line}`).join("\n")}\n`);

    this.#printTags(summary);
    this.#printSlowest(summary);
    if (summary.ai) {
      const { provider, usage } = summary.ai;
      const models = usage.models.length ? ` (${usage.models.join(", ")})` : "";
      this.#write(
        `\n  ${c.bold("Jev")}  ${provider}${models}: ${plural(usage.calls, "call")}, ` +
          `${usage.inputTokens.toLocaleString("en-US")} input tokens, ${formatCost(usage.costUsd)}${usage.costEstimated ? " (estimated)" : ""}\n`,
      );
    }
    this.#write(`\n  ${c.dim(`Finished in ${formatDuration(summary.duration)}`)}\n\n`);
  }

  #printFailure(test: TestCase, index: number): void {
    const c = this.#c;
    const last = test.results.at(-1);
    this.#write(`\n  ${c.red(`${index}) ${testLabel(test)}`)}\n`);
    for (const error of last?.errors ?? []) {
      this.#write(`\n${indent(error.message, 4)}\n`);
      const frame = this.#codeFrame(error);
      if (frame) this.#write(`\n${indent(frame, 4)}\n`);
      else if (error.location) this.#write(c.dim(`\n    at ${this.#relative(error.location.file)}:${error.location.line}:${error.location.column}\n`));
    }
    const { triage } = test;
    if (triage) {
      const probability = triage.probability === undefined ? "" : ` (${Math.round(triage.probability * 100)}%)`;
      this.#write(`\n    ${c.bold("Triage:")} ${triage.label}${probability}${triage.note ? c.dim(` ${triage.note}`) : ""}\n`);
    }
    if (last?.outputDir) this.#write(c.dim(`\n    Artifacts: ${this.#relative(last.outputDir)}\n`));
  }

  #codeFrame(error: SerializedError): string | undefined {
    if (!error.location) return undefined;
    try {
      const source = readFileSync(error.location.file, "utf8");
      const frame = codeFrameColumns(
        source,
        { start: { line: error.location.line, column: error.location.column } },
        { highlightCode: this.#c.isColorSupported, linesAbove: 2, linesBelow: 2 },
      );
      return `${this.#c.dim(`${this.#relative(error.location.file)}:${error.location.line}:${error.location.column}`)}\n\n${frame}`;
    } catch {
      return undefined;
    }
  }

  #printTags(summary: RunSummary): void {
    const byTag = new Map<string, Record<string, number>>();
    for (const test of summary.tests) {
      if (!test.outcome) continue;
      for (const tag of test.tags) {
        const counts = byTag.get(tag) ?? {};
        counts[test.outcome] = (counts[test.outcome] ?? 0) + 1;
        byTag.set(tag, counts);
      }
    }
    if (byTag.size === 0) return;
    const width = Math.max(...[...byTag.keys()].map((tag) => tag.length));
    const rows = [...byTag.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, counts]) => {
        const parts = (["passed", "failed", "flaky", "skipped"] as const)
          .filter((outcome) => counts[outcome])
          .map((outcome) => `${counts[outcome]} ${outcome}`);
        return `    ${tag.padEnd(width)}  ${parts.join(", ")}`;
      });
    this.#write(`\n  ${this.#c.bold("By tag")}\n${rows.join("\n")}\n`);
  }

  #printSlowest(summary: RunSummary): void {
    const slowest = summary.tests
      .filter((test) => test.outcome && test.outcome !== "skipped")
      .map((test) => ({ test, duration: test.results.at(-1)?.duration ?? 0 }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3);
    if (slowest.length === 0) return;
    const rows = slowest.map(({ test, duration }) => `    ${formatDuration(duration).padStart(6)}  ${testLabel(test)}`);
    this.#write(`\n  ${this.#c.bold("Slowest")}\n${rows.join("\n")}\n`);
  }

  #relative(file: string): string {
    return path.relative(this.#rootDir, file) || file;
  }
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
