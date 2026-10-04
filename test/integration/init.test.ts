import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { ESLint } from "eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freePort, isUp, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-init-"));
let server: ChildProcess;
let siteURL: string;

beforeAll(async () => {
  const port = await freePort();
  siteURL = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(projectsDir, "../sites/serve.mjs"), path.join(projectsDir, "../sites/static"), String(port)], {
    stdio: "ignore",
  });
  while (!(await isUp(siteURL))) await new Promise((resolve) => setTimeout(resolve, 50));
});

afterAll(() => {
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
});

function copyProject(name: string): string {
  const target = path.join(scratch, name);
  cpSync(path.join(projectsDir, name), target, { recursive: true });
  linkIntelliwright(target);
  return target;
}

describe.each([
  { name: "init-empty", ext: "mjs", typescript: false },
  { name: "init-next", ext: "ts", typescript: true },
])("init in $name", ({ name, ext, typescript }) => {
  let project: string;
  let output: string;

  beforeAll(async () => {
    project = copyProject(name);
    const run = await runCli(["init", "--provider", "typesafe"], { cwd: project });
    expect(run.code).toBe(0);
    output = run.stdout;
  });

  test("creates e2e/pages/, never a root pages/ folder", () => {
    for (const file of [`intelliwright.config.${ext}`, `e2e/pages/home.page.${ext}`, `e2e/fixtures.${ext}`, `e2e/home.e2e.${ext}`]) {
      expect(existsSync(path.join(project, file)), file).toBe(true);
    }
    expect(existsSync(path.join(project, "pages"))).toBe(false);
  });

  test("writes the provider line, never a key, and matching commands", () => {
    const config = readFileSync(path.join(project, `intelliwright.config.${ext}`), "utf8");
    expect(config).toContain('ai: { provider: "typesafe" }, // reads TYPESAFE_API_KEY');
    expect(output).toContain("npx intelliwright install chromium");
    expect(output).toContain("Put TYPESAFE_API_KEY in .env.local (never commit it)");
    if (typescript) {
      expect(config).toContain('command: "npm run dev"');
      expect(output).toContain('add "e2e" and "intelliwright.config.ts" to "exclude" in tsconfig.json');
    } else {
      expect(config).toContain("// webServer:");
    }
  });

  test("adds the .gitignore entries once", async () => {
    const gitignore = readFileSync(path.join(project, ".gitignore"), "utf8");
    expect(gitignore).toContain("# Intelliwright\ntest-results/\nintelliwright-report/\n.intelliwright/history.json");
    const again = await runCli(["init", "--provider", "typesafe"], { cwd: project });
    expect(again.stdout).toContain("Kept the existing");
    expect(readFileSync(path.join(project, ".gitignore"), "utf8")).toBe(gitignore);
  });

  test("the example test passes", async () => {
    const run = await runCli(["test", "--base-url", siteURL, "--reporter", "terminal"], { cwd: project });
    expect(run.stdout).toContain(`✓  e2e/home.e2e.${ext}:4 › home page › shows its main heading`);
    expect(run.stdout).toContain("1 passed");
    expect(run.code).toBe(0);
  });
});

describe("the generated fixture file and React's hooks lint rule", () => {
  const lint = async (source: string): Promise<string[]> => {
    const eslint = new ESLint({
      cwd: scratch,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ["**/*.js"],
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          plugins: { "react-hooks": reactHooks as unknown as ESLint.Plugin },
          rules: { "react-hooks/rules-of-hooks": "error" },
        },
      ],
    });
    const [result] = await eslint.lintText(stripTypeScriptTypes(source), { filePath: path.join(scratch, "fixtures.js") });
    return result!.messages.map((message) => `${message.ruleId}: ${message.message}`);
  };

  test("passes, while the same file with a use callback would not", async () => {
    const fixtures = readFileSync(path.join(scratch, "init-next", "e2e", "fixtures.ts"), "utf8");
    expect(await lint(fixtures)).toEqual([]);
    const withUse = await lint(fixtures.replaceAll("provide", "use"));
    expect(withUse.some((message) => message.startsWith("react-hooks/rules-of-hooks"))).toBe(true);
  });
});
