import type { TestCase } from "./types.js";

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

/** `e2e/login.e2e.ts:12 › login › rejects a bad password` */
export function testLabel(test: TestCase): string {
  return `${test.relFile}:${test.line} › ${test.titlePath.join(" › ")}`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
