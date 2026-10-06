import { realpathSync } from "node:fs";
import path from "node:path";
import { createJiti, type Jiti } from "jiti";

let instance: Jiti | undefined;

/**
 * Loads config and test files in TypeScript or JavaScript, ESM or CommonJS.
 * One instance per process, so shared modules such as `e2e/fixtures.ts` load once.
 */
export function loader(): Jiti {
  instance ??= createJiti(import.meta.url, {
    sourceMaps: true,
    nativeModules: ["intelliwright", "playwright-core", "expect"],
  });
  return instance;
}

export async function importModule(file: string): Promise<unknown> {
  return loader().import(file);
}

/** Drops the modules under `dir`, outside node_modules, so importing them again runs their current code. */
export function forgetModules(dir: string): void {
  // The cache is keyed by real paths, such as /private/tmp for /tmp on macOS, and on Windows with forward slashes.
  const comparable = (file: string): string => (process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file));
  const roots = [...new Set([dir, realpathSync(dir)])].map((root) => comparable(root) + path.sep);
  const cache = loader().cache;
  for (const key of Object.keys(cache)) {
    if (!path.isAbsolute(key)) continue;
    const file = comparable(key);
    if (roots.some((root) => file.startsWith(root)) && !file.split(path.sep).includes("node_modules")) delete cache[key];
  }
}
