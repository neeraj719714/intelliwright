import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { repoRoot } from "../helpers/cli.js";

const exec = promisify(execFile);
const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-pack-"));
const project = path.join(scratch, "fresh-project");
let files: string[];

beforeAll(async () => {
  const { stdout } = await exec("npm", ["pack", "--json", "--pack-destination", scratch], { cwd: repoRoot });
  const [pack] = JSON.parse(stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
  files = pack!.files.map((file) => file.path);

  await exec("mkdir", ["-p", project]);
  writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "fresh-project", private: true, type: "module" }));
  await exec("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", path.join(scratch, pack!.filename)], {
    cwd: project,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the packed tarball", () => {
  test("holds only dist/, skills/, the license and package.json", () => {
    const outside = files.filter((file) => !/^(dist|skills)\//.test(file) && !["LICENSE", "package.json"].includes(file));
    expect(outside).toEqual([]);
    expect(files).toContain("skills/intelliwright/SKILL.md");
    expect(files.some((file) => file.endsWith(".map"))).toBe(false);
  });

  test("doesn't install the AI SDK", async () => {
    expect(existsSync(path.join(project, "node_modules", "ai"))).toBe(false);
    const ls = await exec("npm", ["ls", "ai", "--all", "--json"], { cwd: project }).catch((error: { stdout: string }) => error);
    expect(JSON.parse(ls.stdout).dependencies?.intelliwright?.dependencies?.ai).toBeUndefined();
  });

  test("loads without the AI SDK, and the adapter explains what's missing", async () => {
    const script = `
      const main = await import("intelliwright");
      console.log(typeof main.defineConfig, typeof main.test, typeof main.expect, typeof main.BasePage);
      await import("intelliwright/ai-sdk").catch((error) => console.log(error.code, error.message.split("\\n")[0]));
    `;
    const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", script], { cwd: project });
    const [loaded, adapter] = stdout.trim().split("\n");
    expect(loaded).toBe("function function function function");
    expect(adapter).toMatch(/^ERR_MODULE_NOT_FOUND Cannot find package 'ai'/);
  });

  test("runs its CLI", async () => {
    const { stdout } = await exec(path.join(project, "node_modules", ".bin", "intelliwright"), ["--version"], { cwd: project });
    expect(stdout.trim()).toBe(JSON.parse((await exec("npm", ["pkg", "get", "version"], { cwd: repoRoot })).stdout));
  });
});
