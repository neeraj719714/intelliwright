import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/** Runs Playwright's browser installer. With no browser named, installs chromium. */
export async function install(args: string[]): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve("playwright-core/package.json")), "cli.js");
  const browsers = args.some((arg) => !arg.startsWith("-")) ? [] : ["chromium"];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "install", ...browsers, ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
