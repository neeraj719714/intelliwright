import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import type { ResolvedConfig } from "../config/types.js";
import { SETUP_FILES } from "./auth.js";

/** Test files under `testDir` that match `testMatch`, in a stable order. Setup files are never test files. */
export async function discoverTestFiles(config: ResolvedConfig): Promise<string[]> {
  if (!existsSync(config.testDir)) return [];
  const files = await glob(config.testMatch, {
    cwd: config.testDir,
    absolute: true,
    ignore: ["**/node_modules/**", SETUP_FILES, ...config.testIgnore],
  });
  return files.map((file) => path.normalize(file)).sort();
}
