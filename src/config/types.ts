import type { BrowserContextOptions, LaunchOptions } from "playwright-core";
import type { ProviderSettings } from "../ai/providers/resolve.js";

export type BrowserName = "chromium" | "firefox" | "webkit";

export interface WebServerConfig {
  /** Shell command that starts the app, such as `npm run dev`. */
  command: string;
  /** Responds once the app is ready. */
  url: string;
  /** Use a server already running at `url` instead of starting one. */
  reuseExistingServer?: boolean;
  /** Milliseconds to wait for `url` to respond. Defaults to 60,000. */
  timeout?: number;
  /** Working directory for `command`. Defaults to the config file's folder. */
  cwd?: string;
  env?: Record<string, string>;
  /** Print the server's output. Defaults to false; it is shown if the server fails to start. */
  showOutput?: boolean;
}

/** Browser context options passed to every test, plus default timeouts. */
export interface UseOptions extends Omit<BrowserContextOptions, "baseURL"> {
  /** Milliseconds for each action such as `click`. Defaults to no limit within the test timeout. */
  actionTimeout?: number;
  /** Milliseconds for each navigation. Defaults to no limit within the test timeout. */
  navigationTimeout?: number;
}

export interface AiConfig extends ProviderSettings {
  /** Probability an AI check or action needs to pass. Defaults to 0.7. */
  minProbability?: number;
  /** Cache resolved locators in `.intelliwright/cache.json`. Defaults to true. */
  cache?: boolean;
  /** Ask Jev to label failures. Defaults to true. */
  triage?: boolean;
  /** Text masked before the page state is sent: regexes match text, strings are selectors. */
  redact?: Array<RegExp | string>;
}

export type ReporterName = "terminal" | "html" | "json" | "junit";
export type ReporterSetting = ReporterName | [ReporterName, Record<string, unknown>];

export interface IntelliwrightConfig {
  /** Folder with the tests. Defaults to `e2e`. */
  testDir?: string;
  /** Globs, relative to `testDir`. Defaults to `**\/*.e2e.{ts,js,mts,mjs,cts,cjs}`. */
  testMatch?: string | string[];
  testIgnore?: string | string[];
  /** Failure artifacts and run state. Defaults to `test-results`. */
  outputDir?: string;
  /** Relative URLs in `page.goto` and page objects resolve against it. */
  baseURL?: string;
  webServer?: WebServerConfig | WebServerConfig[];
  use?: UseOptions;
  /** Defaults to `chromium`. */
  browser?: BrowserName;
  launchOptions?: LaunchOptions;
  /** Defaults to true. `--headed` turns it off. */
  headless?: boolean;
  /** Worker processes. Defaults to half the CPU cores. */
  workers?: number;
  /** Extra attempts for a failing test. Defaults to 0. */
  retries?: number;
  /** Milliseconds for each test, fixtures and hooks included. Defaults to 30,000. */
  timeout?: number;
  expect?: { timeout?: number };
  /** Module whose default export runs once before the workers start. It may return a teardown function. */
  globalSetup?: string;
  /** Module whose default export runs once after all tests. */
  globalTeardown?: string;
  /** Attribute used by `getByTestId`. Defaults to `data-testid`. */
  testIdAttribute?: string;
  ai?: AiConfig;
  /** Named tag expressions, run with `--suite <name>`. */
  suites?: Record<string, string>;
  reporters?: ReporterSetting[];
  report?: { open?: "on-failure" | "always" | "never" };
}

/** The config with defaults applied and paths made absolute. */
export interface ResolvedConfig {
  rootDir: string;
  configFile: string | undefined;
  testDir: string;
  testMatch: string[];
  testIgnore: string[];
  outputDir: string;
  baseURL: string | undefined;
  webServer: WebServerConfig[];
  use: UseOptions;
  browser: BrowserName;
  launchOptions: LaunchOptions;
  headless: boolean;
  workers: number;
  retries: number;
  timeout: number;
  expectTimeout: number;
  globalSetup: string | undefined;
  globalTeardown: string | undefined;
  testIdAttribute: string;
  ai: AiConfig;
  suites: Record<string, string>;
  reporters: Array<[ReporterName, Record<string, unknown>]>;
  reportOpen: "on-failure" | "always" | "never";
  updateCache: boolean;
}

/** Command-line flags that override the config. */
export interface ConfigOverrides {
  workers?: number;
  retries?: number;
  headed?: boolean;
  baseURL?: string;
  timeout?: number;
  reporters?: ReporterName[];
  updateCache?: boolean;
}
