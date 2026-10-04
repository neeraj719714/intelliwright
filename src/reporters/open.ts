import { spawn } from "node:child_process";

/** Opens a URL or file in the default browser, without waiting for it. */
export function openInBrowser(target: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

/** Reports open after local runs only, never in CI. */
export function shouldOpenReport(
  open: "on-failure" | "always" | "never",
  status: "passed" | "failed" | "interrupted",
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.CI || open === "never") return false;
  return open === "always" || status !== "passed";
}
