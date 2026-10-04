import { Command, InvalidArgumentError } from "commander";
import colors from "picocolors";
import { REPORTERS } from "../config/load-config.js";
import type { ReporterName } from "../config/types.js";
import { VERSION } from "../version.js";

interface TestCommandOptions {
  config?: string;
  tag?: string;
  grep?: string;
  grepInvert?: string;
  suite?: string;
  list?: boolean;
  lastFailed?: boolean;
  headed?: boolean;
  workers?: number;
  retries?: number;
  timeout?: number;
  reporter?: ReporterName[];
  baseUrl?: string;
  updateCache?: boolean;
}

export function createProgram(entry: string): Command {
  const program = new Command("intelliwright")
    .description("End-to-end tests for web apps, with page objects and Jev-powered checks.")
    .version(VERSION, "-v, --version")
    .showHelpAfterError();

  program
    .command("test")
    .description("run tests")
    .argument("[filters...]", "test files or folders to run; add :line to run the test or describe on that line")
    .option("-c, --config <file>", "config file to use")
    .option("-t, --tag <expression>", 'run tests whose tags match, such as "@smoke and not @slow"')
    .option("-g, --grep <regex>", "run tests whose titles match")
    .option("--grep-invert <regex>", "skip tests whose titles match")
    .option("-s, --suite <name>", "run a named suite from the config")
    .option("--list", "list the matching tests without running them")
    .option("--last-failed", "run only the tests that failed in the previous run")
    .option("--headed", "show the browser while tests run")
    .option("-j, --workers <count>", "number of worker processes", wholeNumber(1))
    .option("--retries <count>", "extra attempts for failing tests", wholeNumber(0))
    .option("--timeout <ms>", "milliseconds per test", wholeNumber(0))
    .option("--reporter <names>", `comma-separated reporters: ${REPORTERS.join(", ")}`, reporterList)
    .option("--base-url <url>", "run against this URL instead of the config's baseURL")
    .option("--update-cache", "resolve every AI action again instead of using cached locators")
    .action(async (filters: string[], options: TestCommandOptions) => {
      const { runTests } = await import("../runner/run.js");
      process.exitCode = await runTests({
        cwd: process.cwd(),
        configFile: options.config,
        workerEntry: entry,
        list: options.list,
        selection: {
          filters,
          tag: options.tag,
          grep: options.grep,
          grepInvert: options.grepInvert,
          suite: options.suite,
          lastFailed: options.lastFailed,
        },
        overrides: {
          workers: options.workers,
          retries: options.retries,
          timeout: options.timeout,
          headed: options.headed,
          baseURL: options.baseUrl,
          reporters: options.reporter,
          updateCache: options.updateCache,
        },
      });
    });

  program
    .command("init")
    .description("set up Intelliwright in this project: config, e2e/ page objects and an example test")
    .option("--provider <name>", "Jev provider: typesafe, vercel, openrouter, cloudflare or auto")
    .option("-y, --yes", "don't ask questions; use the defaults")
    .action(async (options: { provider?: string; yes?: boolean }) => {
      const { init } = await import("./init.js");
      process.exitCode = await init({ cwd: process.cwd(), ...options });
    });

  program
    .command("show-report")
    .description("serve the last HTML report and open it in the browser")
    .argument("[folder]", "report folder", "intelliwright-report")
    .option("--port <port>", "port to serve on", wholeNumber(0), 9323)
    .option("--host <host>", "host to serve on", "localhost")
    .option("--no-open", "don't open the browser")
    .action(async (folder: string, options: { port: number; host: string; open: boolean }) => {
      const { showReport } = await import("./show-report.js");
      process.exitCode = await showReport(folder, options);
    });

  program
    .command("install")
    .description("download browsers (chromium by default); flags such as --with-deps go to Playwright")
    .argument("[browsers...]", "chromium, firefox, webkit or chromium-headless-shell")
    .allowUnknownOption()
    .action(async () => {
      const { install } = await import("./install.js");
      process.exitCode = await install(process.argv.slice(process.argv.indexOf("install") + 1));
    });

  return program;
}

/** Prints a command's error, without a stack trace for known mistakes such as a bad config. */
export function reportCliError(error: unknown): number {
  const known =
    error instanceof Error && ["ConfigError", "WebServerError", "JevError", "SelectionError"].includes(error.name);
  const text = known ? (error as Error).message : String((error as Error)?.stack ?? error);
  process.stderr.write(`${colors.red("Error:")} ${text}\n`);
  return 1;
}

function wholeNumber(min: number): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min) {
      throw new InvalidArgumentError(`Expected a whole number of at least ${min}.`);
    }
    return parsed;
  };
}

function reporterList(value: string): ReporterName[] {
  const names = value.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!REPORTERS.includes(name as ReporterName)) {
      throw new InvalidArgumentError(`Unknown reporter "${name}". Use ${REPORTERS.join(", ")}.`);
    }
  }
  return names as ReporterName[];
}
