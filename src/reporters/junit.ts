import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripAnsi } from "./format.js";
import type { Reporter, RunInfo, RunSummary, TestCase } from "./types.js";

export interface JunitReporterOptions {
  /** Relative to the config folder. Defaults to `test-results/junit.xml`. */
  outputFile?: string;
}

/**
 * JUnit XML for CI. Each file is a testsuite. Flaky tests count as passed,
 * matching the terminal summary: tests = passed + flaky + failed + skipped.
 */
export class JunitReporter implements Reporter {
  readonly #options: JunitReporterOptions;
  #file = "";

  constructor(options: JunitReporterOptions = {}) {
    this.#options = options;
  }

  onBegin(run: RunInfo): void {
    this.#file = path.resolve(run.config.rootDir, this.#options.outputFile ?? path.join("test-results", "junit.xml"));
  }

  onEnd(summary: RunSummary): void {
    const byFile = new Map<string, TestCase[]>();
    for (const test of summary.tests) {
      const tests = byFile.get(test.relFile) ?? [];
      tests.push(test);
      byFile.set(test.relFile, tests);
    }

    const suites = [...byFile.entries()].map(([file, tests]) => {
      const failures = tests.filter((test) => test.outcome === "failed").length;
      const skipped = tests.filter((test) => test.outcome === "skipped").length;
      const time = seconds(tests.reduce((sum, test) => sum + duration(test), 0));
      const cases = tests.map((test) => testCase(test, file)).join("");
      return `  <testsuite name="${xml(file)}" tests="${tests.length}" failures="${failures}" skipped="${skipped}" errors="0" time="${time}">\n${cases}  </testsuite>\n`;
    });

    const { counts } = summary;
    const errors = summary.errors.length;
    const header = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="intelliwright" tests="${summary.tests.length}" failures="${counts.failed}" skipped="${counts.skipped}" errors="${errors}" time="${seconds(summary.duration)}">\n`;
    mkdirSync(path.dirname(this.#file), { recursive: true });
    writeFileSync(this.#file, `${header}${suites.join("")}</testsuites>\n`);
  }
}

function testCase(test: TestCase, file: string): string {
  const name = xml(test.titlePath.join(" › "));
  const open = `    <testcase name="${name}" classname="${xml(file)}" time="${seconds(duration(test))}"`;
  const last = test.results.at(-1);
  const body: string[] = [];
  if (test.outcome === "skipped") {
    const reason = last?.annotations.find((annotation) => annotation.type === "skip" || annotation.type === "fixme")?.description;
    body.push(`      <skipped${reason ? ` message="${xml(reason)}"` : ""}/>\n`);
  } else if (test.outcome === "failed" || test.outcome === undefined) {
    const error = last?.errors[0];
    const message = stripAnsi(error?.message ?? "Test did not finish").split("\n")[0] ?? "";
    const details = stripAnsi([error?.message, error?.stack].filter(Boolean).join("\n\n"));
    body.push(`      <failure message="${xml(message)}" type="${xml(error?.name ?? "Error")}">${xml(details)}</failure>\n`);
  }
  const notes: string[] = [];
  if (test.outcome === "flaky") notes.push(`Flaky: passed on retry ${last?.retry ?? 1}.`);
  if (test.triage) notes.push(`Triage: ${test.triage.label}${test.triage.probability === undefined ? "" : ` (${Math.round(test.triage.probability * 100)}%)`}`);
  for (const attachment of last?.attachments ?? []) {
    if (attachment.path) notes.push(`[[ATTACHMENT|${attachment.path}]]`);
  }
  if (notes.length) body.push(`      <system-out>${xml(notes.join("\n"))}</system-out>\n`);
  return body.length ? `${open}>\n${body.join("")}    </testcase>\n` : `${open}/>\n`;
}

function duration(test: TestCase): number {
  return test.results.reduce((sum, result) => sum + result.duration, 0);
}

function seconds(ms: number): string {
  return (ms / 1_000).toFixed(3);
}

function xml(text: string): string {
  return text
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
