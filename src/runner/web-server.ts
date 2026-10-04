import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { WebServerConfig } from "../config/types.js";

export class WebServerError extends Error {
  override readonly name: string = "WebServerError";
}

export interface RunningServers {
  /** URLs of servers this run started. Ones it reused are not listed. */
  started: string[];
  reused: string[];
  stop(): Promise<void>;
}

/**
 * Starts each `webServer`, waits for its URL to respond, and returns a stop
 * function. A server already responding at its URL is reused when
 * `reuseExistingServer` is set. Servers are skipped when `--base-url` points
 * at a different origin.
 */
export async function startWebServers(
  configs: WebServerConfig[],
  rootDir: string,
  baseURLOverride: string | undefined,
): Promise<RunningServers> {
  const processes: ChildProcess[] = [];
  const started: string[] = [];
  const reused: string[] = [];
  const stop = async (): Promise<void> => {
    await Promise.all(processes.map((child) => killTree(child)));
  };

  try {
    for (const config of configs) {
      if (baseURLOverride && origin(baseURLOverride) !== origin(config.url)) continue;
      if (await isReady(config.url)) {
        if (config.reuseExistingServer) {
          reused.push(config.url);
          continue;
        }
        throw new WebServerError(
          `${config.url} is already in use. Stop whatever is running there, or set reuseExistingServer: true.`,
        );
      }
      processes.push(await launch(config, rootDir));
      started.push(config.url);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { started, reused, stop };
}

async function launch(config: WebServerConfig, rootDir: string): Promise<ChildProcess> {
  const child = spawn(config.command, {
    cwd: config.cwd ? path.resolve(rootDir, config.cwd) : rootDir,
    env: { ...process.env, ...config.env },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const output: string[] = [];
  const collect = (chunk: Buffer): void => {
    const text = chunk.toString();
    if (config.showOutput) process.stdout.write(text);
    output.push(text);
    if (output.length > 200) output.shift();
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let exited: string | undefined;
  child.on("exit", (code, signal) => {
    exited = signal ?? `code ${code}`;
  });
  child.on("error", (error) => {
    exited = error.message;
  });

  const timeout = config.timeout ?? 60_000;
  const deadline = Date.now() + timeout;
  for (let delay = 100; ; delay = Math.min(delay * 2, 1_000)) {
    if (exited !== undefined) {
      throw new WebServerError(
        `webServer "${config.command}" exited (${exited}) before ${config.url} responded.${tail(output)}`,
      );
    }
    if (await isReady(config.url)) return child;
    if (Date.now() > deadline) {
      await killTree(child);
      throw new WebServerError(
        `webServer "${config.command}" didn't respond at ${config.url} within ${timeout}ms.${tail(output)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** A URL counts as ready when it answers with a status from 200 to 403. */
export async function isReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 404;
  } catch {
    return false;
  }
}

async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  const timer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {}
  }, 5_000);
  await exited;
  clearTimeout(timer);
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function tail(output: string[]): string {
  const text = output.join("").trim().split("\n").slice(-20).join("\n");
  return text ? `\nLast output:\n${text}` : "";
}
