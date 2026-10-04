import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { commands, detectProject } from "../../src/cli/init.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "intelliwright-detect-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(dir, name), contents);
  return dir;
}

describe("detectProject", () => {
  test("reads the package manager from the lockfile, then the user agent", () => {
    expect(detectProject(project({ "pnpm-lock.yaml": "" }), {}).packageManager).toBe("pnpm");
    expect(detectProject(project({ "yarn.lock": "" }), {}).packageManager).toBe("yarn");
    expect(detectProject(project({ "bun.lock": "" }), {}).packageManager).toBe("bun");
    expect(detectProject(project({}), { npm_config_user_agent: "pnpm/10.0.0 npm/? node/v24" }).packageManager).toBe("pnpm");
    expect(detectProject(project({}), {}).packageManager).toBe("npm");
  });

  test("reads TypeScript, the framework and the dev script", () => {
    const next = project({
      "package.json": JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "16" } }),
      "tsconfig.json": "{}",
    });
    expect(detectProject(next, {})).toEqual({ packageManager: "npm", typescript: true, framework: "next", devScript: "dev" });
    const vite = project({ "package.json": JSON.stringify({ scripts: { start: "vite" }, devDependencies: { vite: "7" } }) });
    expect(detectProject(vite, {})).toMatchObject({ typescript: false, framework: "vite", devScript: "start" });
  });
});

test("commands match the package manager", () => {
  expect(commands("npm")).toMatchObject({ add: "npm install --save-dev intelliwright", exec: "npx intelliwright" });
  expect(commands("pnpm").run("dev")).toBe("pnpm dev");
  expect(commands("yarn").exec).toBe("yarn intelliwright");
  expect(commands("bun").add).toBe("bun add -d intelliwright");
});
