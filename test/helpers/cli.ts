import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
export const cliPath = path.join(repoRoot, "dist", "cli.js");
export const projectsDir = path.join(repoRoot, "test", "fixtures", "projects");

/** Points `<project>/node_modules/intelliwright` at this repo, as `npm link` would. */
export function linkIntelliwright(projectDir: string): void {
  const modules = path.join(projectDir, "node_modules");
  const link = path.join(modules, "intelliwright");
  mkdirSync(modules, { recursive: true });
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) return;
  symlinkSync(repoRoot, link, process.platform === "win32" ? "junction" : "dir");
}

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], options: { cwd: string; env?: Record<string, string> }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1", ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return true;
  } catch {
    return false;
  }
}
