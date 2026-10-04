import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Location, SerializedError } from "./types.js";

const POSITION = /^(.+):(\d+):(\d+)$/;

/**
 * Parses `at ...` lines of a V8 stack trace into file locations. Frames come
 * as `at fn (/file.ts:1:2)` or, for module top level, `at /file.ts:1:2`.
 */
export function parseStack(stack: string): Location[] {
  const frames: Location[] = [];
  for (const line of stack.split("\n")) {
    let rest = line.trim();
    if (!rest.startsWith("at ")) continue;
    rest = rest.slice(3);
    if (rest.startsWith("async ")) rest = rest.slice(6);
    const open = rest.indexOf(" (");
    const position = rest.endsWith(")") && open !== -1 ? rest.slice(open + 2, -1) : rest;
    const match = POSITION.exec(position);
    if (!match) continue;
    const [, rawFile = "", rawLine = "0", rawColumn = "0"] = match;
    if (rawFile.startsWith("node:") || rawFile.startsWith("<")) continue;
    const file = rawFile.startsWith("file://") ? fileURLToPath(rawFile) : rawFile;
    frames.push({ file: path.normalize(file), line: Number(rawLine), column: Number(rawColumn) });
  }
  return frames;
}

/** The line in `file` that called into Intelliwright. */
export function callerLocation(file: string): Location {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 100;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = limit;
  const normalized = path.normalize(file);
  return parseStack(stack).find((frame) => frame.file === normalized) ?? { file, line: 0, column: 0 };
}

/** The first stack frame in the user's own code, outside node_modules. */
export function userFrame(stack: string | undefined, rootDir: string): Location | undefined {
  if (!stack) return undefined;
  const root = path.normalize(rootDir) + path.sep;
  return parseStack(stack).find(
    (frame) => frame.file.startsWith(root) && !frame.file.split(path.sep).includes("node_modules"),
  );
}

export function serializeError(error: unknown, rootDir?: string): SerializedError {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message, stack, name } = error as { message: unknown; stack?: unknown; name?: unknown };
    const stackText = typeof stack === "string" ? stack : undefined;
    return {
      message: String(message),
      name: typeof name === "string" ? name : undefined,
      stack: stackText,
      location: rootDir ? userFrame(stackText, rootDir) : undefined,
    };
  }
  return { message: `Thrown value: ${String(error)}` };
}

export function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}
