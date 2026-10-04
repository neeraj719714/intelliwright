import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { freePort, isUp, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

const project = path.join(projectsDir, "auth");
let server: ChildProcess;
let siteURL: string;

interface Attempt {
  startTime: number;
  duration: number;
  annotations: Array<{ type: string; description?: string }>;
  attachments: Array<{ name: string }>;
  errors: Array<{ message: string }>;
}
interface Result {
  id: string;
  titlePath: string[];
  auth?: string;
  authSetup?: string;
  outcome: string;
  attempts: Attempt[];
}
interface Report {
  errors: Array<{ message: string }>;
  tests: Result[];
}

beforeAll(async () => {
  linkIntelliwright(project);
  const port = await freePort();
  siteURL = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(projectsDir, "../sites/serve.mjs"), path.join(projectsDir, "../sites/static"), String(port)], {
    stdio: "ignore",
  });
  while (!(await isUp(siteURL))) await new Promise((resolve) => setTimeout(resolve, 50));
});

afterAll(() => server.kill());

async function run(args: string[], env?: Record<string, string>) {
  const result = await runCli(["test", "--base-url", siteURL, ...args], { cwd: project, env });
  const report = JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as Report;
  return { ...result, report };
}

test("signs in once per role before the tests that need it, and saves the state", async () => {
  rmSync(path.join(project, ".intelliwright"), { recursive: true, force: true });
  const { code, report, stdout } = await run([]);
  expect(code).toBe(0);

  const signIns = report.tests.filter((test) => test.authSetup);
  expect(signIns.map((test) => [test.titlePath.join(" › "), test.outcome])).toEqual([
    ["sign in as member", "passed"],
    ["sign in as admin", "passed"],
  ]);
  const others = report.tests.filter((test) => !test.authSetup);
  expect(others.map((test) => [test.titlePath.at(-1), test.auth ?? null, test.outcome])).toEqual([
    ["members start signed in, with their local storage", "member", "passed"],
    ["admins start signed in as themselves", "admin", "passed"],
    ["guests start signed out", null, "passed"],
    ["a role can be switched off", null, "passed"],
  ]);
  const signedIn = Math.max(...signIns.map((test) => test.attempts[0]!.startTime + test.attempts[0]!.duration));
  expect(Math.min(...others.map((test) => test.attempts[0]!.startTime))).toBeGreaterThanOrEqual(signedIn);
  expect(stdout).toContain("✓  e2e/auth.setup.ts:3 › sign in as member");

  const state = JSON.parse(readFileSync(path.join(project, ".intelliwright", "auth", "member.json"), "utf8"));
  expect(state.cookies).toEqual([expect.objectContaining({ name: "session", value: "Jane" })]);
  expect(state.origins).toEqual([expect.objectContaining({ origin: siteURL, localStorage: [{ name: "theme", value: "dark" }] })]);
});

test("runs no sign-in when the selected tests don't need one", async () => {
  const { code, report } = await run(["--tag", "@guest"]);
  expect(code).toBe(0);
  expect(report.tests.map((test) => [test.titlePath.at(-1), test.outcome])).toEqual([
    ["guests start signed out", "passed"],
    ["a role can be switched off", "passed"],
  ]);
});

test("a failed sign-in skips only the tests that need it, and keeps no trace of the password", async () => {
  const { code, report } = await run([], { MEMBER_PASSWORD: "wrong" });
  expect(code).toBe(1);

  const member = report.tests.find((test) => test.authSetup === "member")!;
  expect(member.outcome).toBe("failed");
  expect(member.attempts[0]!.attachments.map((attachment) => attachment.name)).not.toContain("trace");
  const blocked = report.tests.find((test) => test.auth === "member")!;
  expect(blocked.outcome).toBe("skipped");
  expect(blocked.attempts[0]!.annotations).toContainEqual({ type: "skip", description: 'Signing in as "member" failed.' });
  const rest = report.tests.filter((test) => test !== member && test !== blocked);
  expect(rest.map((test) => test.outcome)).toEqual(["passed", "passed", "passed", "passed"]);

  const lastRun = JSON.parse(readFileSync(path.join(project, "test-results", ".last-run.json"), "utf8"));
  expect(lastRun.failedTests).toEqual([blocked.id]);
});

test("a role without a sign-in is an error, and its tests don't run", async () => {
  const { code, report } = await run(["--tag", "@guest"], { GHOST_ROLE: "ghost" });
  expect(code).toBe(1);
  expect(report.errors.map((error) => error.message)).toEqual([
    'No sign-in for "ghost". Add test.auth("ghost", async ({ page }) => { ... }) to a setup file such as e2e/auth.setup.ts.',
  ]);
  const ghost = report.tests.find((test) => test.auth === "ghost")!;
  expect(ghost.outcome).toBe("skipped");
  expect(ghost.attempts[0]!.annotations).toContainEqual({ type: "skip", description: 'No sign-in for "ghost".' });
});

test("--list names the roles it signs in as first", async () => {
  const { code, stdout } = await runCli(["test", "--list"], { cwd: project });
  expect(code).toBe(0);
  expect(stdout).toContain("Total: 4 tests in 2 files");
  expect(stdout).toContain("Signs in first as: admin, member");
});

test("sign-ins live only in setup files, one per role", async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-auth-"));
  try {
    const copy = path.join(scratch, "auth");
    cpSync(project, copy, { recursive: true, filter: (source) => !/node_modules|test-results|\.intelliwright/.test(source) });
    linkIntelliwright(copy);
    writeFileSync(
      path.join(copy, "e2e", "again.setup.ts"),
      'import { test } from "intelliwright";\ntest.auth("member", async () => {});\ntest("not a sign-in", async () => {});\n',
    );
    writeFileSync(path.join(copy, "e2e", "misplaced.e2e.ts"), 'import { test } from "intelliwright";\ntest.auth("member", async () => {});\n');
    writeFileSync(path.join(copy, "e2e", "named.setup.ts"), 'import { test } from "intelliwright";\ntest.auth("member/admin", async () => {});\n');

    const { code, stderr } = await runCli(["test", "--list"], { cwd: copy });
    expect(code).toBe(1);
    expect(stderr).toContain('test.auth("member") belongs in a setup file next to your tests, such as e2e/auth.setup.ts.');
    expect(stderr).toContain('Setup files only hold sign-ins. Move test("not a sign-in") into a test file, or use test.auth("role", ...).');
    expect(stderr).toContain('test.auth() needs a role name of letters, numbers, - and _, such as "member". Got "member/admin".');

    writeFileSync(path.join(copy, "e2e", "again.setup.ts"), 'import { test } from "intelliwright";\ntest.auth("member", async () => {});\n');
    const duplicate = await runCli(["test", "--list"], { cwd: copy });
    expect(duplicate.stderr).toContain('There are two sign-ins for "member": e2e/again.setup.ts:2 and e2e/auth.setup.ts:3. Keep one.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
