import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import type { ResolvedConfig } from "../config/types.js";

/** Files that hold `test.auth()` sign-ins, such as `e2e/auth.setup.ts`. */
export const SETUP_FILES = "**/*.setup.{ts,mts,cts,js,mjs,cjs}";
const SETUP_FILE = /\.setup\.[cm]?[jt]s$/;

export function isSetupFile(file: string): boolean {
  return SETUP_FILE.test(file);
}

/** Throws unless `role` can name a state file, such as `member` or `admin-2`. */
export function checkRole(role: unknown, where: string): string {
  if (typeof role !== "string" || !/^[A-Za-z0-9][\w-]{0,63}$/.test(role)) {
    throw new Error(`${where} needs a role name of letters, numbers, - and _, such as "member". Got ${JSON.stringify(role)}.`);
  }
  return role;
}

/** Where `test.auth(role)` saves the signed-in state. It holds session cookies, so it's never committed. */
export function authStatePath(rootDir: string, role: string): string {
  return path.join(rootDir, ".intelliwright", "auth", `${role}.json`);
}

export async function discoverSetupFiles(config: ResolvedConfig): Promise<string[]> {
  if (!existsSync(config.testDir)) return [];
  const files = await glob(SETUP_FILES, {
    cwd: config.testDir,
    absolute: true,
    ignore: ["**/node_modules/**", ...config.testIgnore],
  });
  return files.map((file) => path.normalize(file)).sort();
}
