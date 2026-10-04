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
