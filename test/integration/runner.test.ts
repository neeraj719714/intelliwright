import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { freePort, isUp, linkIntelliwright, projectsDir, runCli, type CliResult } from "../helpers/cli.js";

const basic = path.join(projectsDir, "basic");
const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-runner-"));

beforeAll(() => {
  for (const name of ["basic", "esm", "cjs"]) linkIntelliwright(path.join(projectsDir, name));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the basic project", () => {
  let run: CliResult;
  let port: number;
  const workerLog = path.join(scratch, "workers.log");

  beforeAll(async () => {
    port = await freePort();
    run = await runCli(["test"], { cwd: basic, env: { FIXTURE_PORT: String(port), WORKER_LOG: workerLog } });
  });

  test("runs several files across two workers", () => {
    expect(run.stdout).toContain("Running 9 tests using 2 workers");
    const workers = new Set(readFileSync(workerLog, "utf8").trim().split("\n"));
    expect([...workers].sort()).toEqual(["0", "1"]);
  });

  test("reports passes, failures, timeouts, retries and skips", () => {
    const out = run.stdout;
    expect(out).toMatch(/✓ {2}e2e\/home\.e2e\.ts:7 › home page › shows the welcome heading \(\d+m?s\)/);
    expect(out).toMatch(/✓ {2}e2e\/home\.e2e\.ts:13 › home page › links to the about page/);
    expect(out).toMatch(/✓ {2}e2e\/about\.e2e\.ts:6 › shows the about heading/);
    expect(out).toMatch(/✘ {2}e2e\/about\.e2e\.ts:11 › has the wrong title on purpose .* failed, retrying\n/);
    expect(out).toMatch(/✘ {2}e2e\/about\.e2e\.ts:11 › has the wrong title on purpose .* failed\n/);
    expect(out).toMatch(/✘ {2}e2e\/timing\.e2e\.ts:6 › runs out of time .* timed out, retrying\n/);
    expect(out).toMatch(/✘ {2}e2e\/timing\.e2e\.ts:6 › runs out of time .* timed out\n/);
    expect(out).toMatch(/✘ {2}e2e\/flaky\.e2e\.ts:6 › passes on the second attempt .* failed, retrying\n/);
    expect(out).toMatch(/✓ {2}e2e\/flaky\.e2e\.ts:6 › passes on the second attempt .* flaky, passed on retry 1/);
    expect(out).toContain("-  e2e/skip.e2e.ts:3 › is skipped");
    expect(out).toContain("-  e2e/skip.e2e.ts:6 › not ready › is marked fixme");
    expect(out).toContain("-  e2e/skip.e2e.ts:9 › skips itself at runtime");

    expect(out).toContain('Expected: "Not the about page"');
    expect(out).toContain("at e2e/about.e2e.ts:13:");
    expect(out).toContain("Test timeout of 1000ms exceeded.");
    expect(out).toMatch(/3 passed\n {2}2 failed\n.*\n.*\n {2}1 flaky\n.*\n {2}3 skipped\n/);
    expect(run.code).toBe(1);
  });

  test("starts the web server and stops it when the run ends", async () => {
    expect(run.stdout).toMatch(/✓ {2}e2e\/home\.e2e\.ts:7/);
    expect(await isUp(`http://127.0.0.1:${port}/`)).toBe(false);
  });
});

test("an ESM project runs", async () => {
  const run = await runCli(["test"], { cwd: path.join(projectsDir, "esm") });
  expect(run.stdout).toMatch(/✓ {2}tests\/smoke\.e2e\.mjs:3 › runs in an ESM project/);
  expect(run.stdout).toContain("1 passed");
  expect(run.code).toBe(0);
});

test("a CommonJS project runs", async () => {
  const run = await runCli(["test"], { cwd: path.join(projectsDir, "cjs") });
  expect(run.stdout).toMatch(/✓ {2}tests\/smoke\.e2e\.js:3 › runs in a CommonJS project/);
  expect(run.stdout).toContain("1 passed");
  expect(run.code).toBe(0);
});

test("use, test.use, globalSetup, testIdAttribute, --base-url and custom fixtures", async () => {
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(projectsDir, "../sites/serve.mjs"), path.join(projectsDir, "../sites/static"), String(port)], {
    stdio: "ignore",
  });
  try {
    const baseURL = `http://127.0.0.1:${port}`;
    while (!(await isUp(baseURL))) await new Promise((resolve) => setTimeout(resolve, 50));
    const marker = path.join(scratch, "teardown.txt");
    const options = path.join(projectsDir, "options");
    linkIntelliwright(options);

    const run = await runCli(["test", "--base-url", baseURL], {
      cwd: options,
      env: { TEARDOWN_MARKER: marker, EXPECTED_BASE_URL: baseURL },
    });

    expect(run.stdout).toContain("7 passed");
    expect(run.stdout).not.toContain("failed");
    expect(run.code).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("torn down");
  } finally {
    server.kill();
  }
});

test("a missing config file is reported without a stack trace", async () => {
  const run = await runCli(["test", "--config", "nope.config.ts"], { cwd: scratch });
  expect(run.stderr).toContain("Error: Config file not found:");
  expect(run.stderr).not.toContain("    at ");
  expect(run.code).toBe(1);
});
