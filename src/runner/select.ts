import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestCase } from "../reporters/types.js";
import { toPosix } from "./location.js";
import { parseTagExpression, SelectionError } from "./tag-expression.js";

export interface SelectionOptions {
  /** Files or folders, each optionally followed by `:line`. */
  filters?: string[];
  tag?: string;
  grep?: string;
  grepInvert?: string;
  suite?: string;
  lastFailed?: boolean;
}

export interface SelectionContext {
  cwd: string;
  suites: Record<string, string>;
  outputDir: string;
}

export interface Selection {
  tests: TestCase[];
  /** Explains an empty selection that isn't a mistake, such as no failures last run. */
  note?: string;
}

interface FileFilter {
  raw: string;
  file: string;
  line: number | undefined;
}

/** Narrows the collected tests by file and line, tags, title, suite and the last run's failures. */
export function selectTests(tests: TestCase[], options: SelectionOptions, context: SelectionContext): Selection {
  let selected = tests;

  const filters = (options.filters ?? []).map((raw) => parseFileFilter(raw, context.cwd));
  if (filters.length > 0) {
    selected = selected.filter((test) => filters.some((filter) => matchesFile(test, filter)));
  }

  const expressions = [options.tag];
  if (options.suite !== undefined) {
    const expression = context.suites[options.suite];
    if (expression === undefined) {
      const known = Object.keys(context.suites);
      throw new SelectionError(
        `There is no suite named "${options.suite}". ${known.length ? `Suites in the config: ${known.join(", ")}.` : "Add one under suites in the config."}`,
      );
    }
    expressions.push(expression);
  }
  for (const expression of expressions) {
    if (expression === undefined) continue;
    const matches = parseTagExpression(expression);
    selected = selected.filter((test) => matches(test.tags));
  }

  if (options.grep !== undefined) {
    const pattern = regex(options.grep, "--grep");
    selected = selected.filter((test) => pattern.test(searchableTitle(test)));
  }
  if (options.grepInvert !== undefined) {
    const pattern = regex(options.grepInvert, "--grep-invert");
    selected = selected.filter((test) => !pattern.test(searchableTitle(test)));
  }

  if (options.lastFailed) {
    const lastRun = readLastRun(context.outputDir);
    if (!lastRun) {
      return { tests: [], note: `There is no previous run in ${path.join(context.outputDir, LAST_RUN_FILE)}.` };
    }
    const failed = new Set(lastRun.failedTests);
    selected = selected.filter((test) => failed.has(test.id));
    if (selected.length === 0) return { tests: [], note: "No tests failed in the last run." };
  }

  const focused = selected.filter((test) => test.only);
  return { tests: focused.length > 0 ? focused : selected };
}

/** `Describe title test title @tag`, as matched by `--grep`. */
export function searchableTitle(test: TestCase): string {
  return [...test.titlePath, ...test.tags].join(" ");
}

function parseFileFilter(raw: string, cwd: string): FileFilter {
  const match = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(raw);
  const target = match?.[1] || raw;
  return { raw, file: path.resolve(cwd, target), line: match?.[2] ? Number(match[2]) : undefined };
}

function matchesFile(test: TestCase, filter: FileFilter): boolean {
  const fileMatches = existsSync(filter.file)
    ? test.file === filter.file || test.file.startsWith(filter.file + path.sep)
    : test.relFile.includes(toPosix(filter.raw.replace(/(?::\d+){1,2}$/, "")));
  if (!fileMatches) return false;
  return filter.line === undefined || test.line === filter.line || test.describeLines.includes(filter.line);
}

function regex(source: string, flag: string): RegExp {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new SelectionError(`${flag} "${source}" is not a valid regular expression: ${(error as Error).message}`);
  }
}

export const LAST_RUN_FILE = ".last-run.json";

export interface LastRun {
  status: "passed" | "failed" | "interrupted";
  failedTests: string[];
}

export function readLastRun(outputDir: string): LastRun | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(outputDir, LAST_RUN_FILE), "utf8")) as Partial<LastRun>;
    return { status: parsed.status ?? "failed", failedTests: Array.isArray(parsed.failedTests) ? parsed.failedTests : [] };
  } catch {
    return undefined;
  }
}

export function writeLastRun(outputDir: string, lastRun: LastRun): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, LAST_RUN_FILE), `${JSON.stringify(lastRun, null, 2)}\n`);
}
