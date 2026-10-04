import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { importModule } from "../runner/loader.js";
import type {
  BrowserName,
  ConfigOverrides,
  IntelliwrightConfig,
  ReporterName,
  ReporterSetting,
  ResolvedConfig,
} from "./types.js";

export const CONFIG_FILES: readonly string[] = [
  "intelliwright.config.ts",
  "intelliwright.config.mts",
  "intelliwright.config.cts",
  "intelliwright.config.js",
  "intelliwright.config.mjs",
  "intelliwright.config.cjs",
];

const BROWSERS: readonly BrowserName[] = ["chromium", "firefox", "webkit"];
export const REPORTERS: readonly ReporterName[] = ["terminal", "html", "json", "junit"];

export class ConfigError extends Error {
  override readonly name: string = "ConfigError";
}

export function findConfigFile(dir: string): string | undefined {
  return CONFIG_FILES.map((name) => path.join(dir, name)).find((file) => existsSync(file));
}

/** `.env.local` first, then `.env`. Variables already set are never overwritten. */
export function loadEnvFiles(rootDir: string): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(rootDir, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export interface LoadConfigOptions {
  cwd: string;
  configFile?: string;
  overrides?: ConfigOverrides;
}

export async function loadConfig(options: LoadConfigOptions): Promise<ResolvedConfig> {
  const configFile = options.configFile
    ? path.resolve(options.cwd, options.configFile)
    : findConfigFile(options.cwd);
  if (configFile && !existsSync(configFile)) {
    throw new ConfigError(`Config file not found: ${configFile}`);
  }
  const rootDir = configFile ? path.dirname(configFile) : path.resolve(options.cwd);
  loadEnvFiles(rootDir);

  let user: unknown = {};
  if (configFile) {
    const loaded = (await importModule(configFile)) as { default?: unknown } | undefined;
    user = loaded?.default ?? loaded;
    if (typeof user !== "object" || user === null) {
      throw new ConfigError(`${path.basename(configFile)} must export a config object, such as export default defineConfig({ ... }).`);
    }
  }
  return resolveConfig(user as IntelliwrightConfig, rootDir, configFile, options.overrides ?? {});
}

export function resolveConfig(
  user: IntelliwrightConfig,
  rootDir: string,
  configFile: string | undefined,
  overrides: ConfigOverrides,
): ResolvedConfig {
  const browser = user.browser ?? "chromium";
  if (!BROWSERS.includes(browser)) {
    throw new ConfigError(`browser must be one of ${BROWSERS.join(", ")}, got "${String(browser)}".`);
  }
  return {
    rootDir,
    configFile,
    testDir: path.resolve(rootDir, user.testDir ?? "e2e"),
    testMatch: toArray(user.testMatch ?? "**/*.e2e.{ts,js,mts,mjs,cts,cjs}"),
    testIgnore: toArray(user.testIgnore ?? []),
    outputDir: path.resolve(rootDir, user.outputDir ?? "test-results"),
    baseURL: overrides.baseURL ?? user.baseURL,
    webServer: toArray(user.webServer ?? []),
    use: user.use ?? {},
    browser,
    launchOptions: user.launchOptions ?? {},
    headless: overrides.headed ? false : (user.headless ?? true),
    workers: count("workers", overrides.workers ?? user.workers ?? Math.max(1, Math.floor(availableParallelism() / 2)), 1),
    retries: count("retries", overrides.retries ?? user.retries ?? 0, 0),
    timeout: count("timeout", overrides.timeout ?? user.timeout ?? 30_000, 0),
    expectTimeout: count("expect.timeout", user.expect?.timeout ?? 5_000, 0),
    globalSetup: user.globalSetup ? path.resolve(rootDir, user.globalSetup) : undefined,
    globalTeardown: user.globalTeardown ? path.resolve(rootDir, user.globalTeardown) : undefined,
    testIdAttribute: user.testIdAttribute ?? "data-testid",
    ai: user.ai ?? {},
    suites: user.suites ?? {},
    reporters: resolveReporters(overrides.reporters ?? user.reporters ?? ["terminal"]),
    reportOpen: user.report?.open ?? "on-failure",
    updateCache: overrides.updateCache ?? false,
  };
}

function resolveReporters(settings: ReadonlyArray<ReporterSetting>): Array<[ReporterName, Record<string, unknown>]> {
  return settings.map((setting) => {
    const [name, options] = typeof setting === "string" ? [setting, {}] : setting;
    if (!REPORTERS.includes(name)) {
      throw new ConfigError(`Unknown reporter "${String(name)}". Use ${REPORTERS.join(", ")}.`);
    }
    return [name, options ?? {}];
  });
}

function count(name: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new ConfigError(`${name} must be a whole number of at least ${min}, got ${String(value)}.`);
  }
  return value;
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
