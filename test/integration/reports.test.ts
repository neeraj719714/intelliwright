import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeTestBrowser, parseXml, readTraceInViewer, testBrowser } from "../helpers/browser.js";
import { cliPath, freePort, linkIntelliwright, projectsDir, runCli, type CliResult } from "../helpers/cli.js";

const basic = path.join(projectsDir, "basic");
let run: CliResult;
let results: {
  stats: Record<string, number>;
  tests: Array<{
    titlePath: string[];
    outcome: string;
    attempts: Array<{ outputDir?: string; attachments: Array<{ name: string; path?: string }> }>;
  }>;
};

beforeAll(async () => {
  linkIntelliwright(basic);
  const port = await freePort();
  run = await runCli(["test", "--reporter", "terminal,html,json,junit"], { cwd: basic, env: { FIXTURE_PORT: String(port) } });
  results = JSON.parse(readFileSync(path.join(basic, "test-results", "results.json"), "utf8"));
});

afterAll(() => closeTestBrowser());

const attemptsOf = (title: string) => results.tests.find((test) => test.titlePath.at(-1) === title)!.attempts;

describe("failure artifacts", () => {
  test("a failing test saves a screenshot, trace, ARIA snapshot, and console and network logs", () => {
    const [attempt] = attemptsOf("has the wrong title on purpose");
    expect(attempt!.attachments.map((a) => a.name).sort()).toEqual(["aria snapshot", "console", "network", "screenshot", "trace"]);
    const file = (name: string) => readFileSync(attempt!.attachments.find((a) => a.name === name)!.path!);

    expect(file("screenshot").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(file("trace").subarray(0, 2).toString()).toBe("PK");
    expect(file("aria snapshot").toString()).toContain('heading "About us" [level=1]');
    expect(file("console").toString()).toContain("[log] about page loaded");
    expect(file("console").toString()).toContain("404 (Not Found)");
    const network = JSON.parse(file("network").toString()) as Array<{ url: string; status: number }>;
    expect(network.find((entry) => entry.url.endsWith("/missing.png"))?.status).toBe(404);
  });

  test("passing tests keep no artifacts", () => {
    const [attempt] = attemptsOf("shows the about heading");
    expect(attempt!.attachments).toEqual([]);
    expect(attempt!.outputDir).toBeUndefined();
  });

  test("the terminal summary shows the code frame and where the artifacts are", () => {
    expect(run.stdout).toContain("> 13 |   expect(await page.title()).toBe(\"Not the about page\");");
    expect(run.stdout).toMatch(/Artifacts: test-results\/e2e-about-e2e-has-the-wrong-title-on-purpose-[0-9a-f]{6}-retry1/);
    expect(run.stdout).toMatch(/By tag\n {4}@smoke {2}2 passed/);
    expect(run.stdout).toContain("Slowest");
  });

  test("the trace opens in Playwright's trace viewer", async () => {
    const [attempt] = attemptsOf("has the wrong title on purpose");
    const text = await readTraceInViewer(attempt!.attachments.find((a) => a.name === "trace")!.path!);
    expect(text).toContain("has the wrong title on purpose");
    expect(text).toContain("Navigate");
    expect(text).toContain("/about.html");
  });
});

test("the JUnit file parses, and its counts match the terminal summary", async () => {
  const xml = readFileSync(path.join(basic, "test-results", "junit.xml"), "utf8");
  const parsed = await parseXml(xml);
  expect(parsed.error).toBeNull();

  const summary = Object.fromEntries(
    [...run.stdout.matchAll(/^ {2}(\d+) (passed|failed|flaky|skipped)$/gm)].map(([, count, outcome]) => [outcome, Number(count)]),
  );
  expect(summary).toEqual({ passed: 3, failed: 2, flaky: 1, skipped: 3 });
  expect(parsed.root).toMatchObject({ tests: "9", failures: String(summary.failed), skipped: String(summary.skipped), errors: "0" });
  expect(parsed.suites.map((suite) => [suite.name, suite.tests, suite.failures, suite.skipped, suite.cases])).toEqual([
    ["e2e/about.e2e.ts", "2", "1", "0", 2],
    ["e2e/flaky.e2e.ts", "1", "0", "0", 1],
    ["e2e/home.e2e.ts", "2", "0", "0", 2],
    ["e2e/skip.e2e.ts", "3", "0", "3", 3],
    ["e2e/timing.e2e.ts", "1", "1", "0", 1],
  ]);
  expect(results.stats).toEqual({ total: 9, passed: 3, failed: 2, flaky: 1, skipped: 3 });
});

test("the HTML report works offline as a single file, and its filters work", async () => {
  const page = await (await testBrowser()).newPage();
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  try {
    await page.goto(pathToFileURL(path.join(basic, "intelliwright-report", "index.html")).href);
    await expectText(page.getByTestId("totals"), "9 tests: 3 passed, 2 failed, 1 flaky, 3 skipped");
    const rows = page.getByTestId("test-row");
    await expectCount(rows, 9);

    await page.getByRole("button", { name: "Failed (2)" }).click();
    await expectCount(rows, 2);
    expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-outcome")))).toEqual(["failed", "failed"]);

    await page.getByRole("button", { name: "All (9)" }).click();
    await page.getByLabel("Tag").selectOption("@smoke");
    await expectCount(rows, 2);

    await page.getByLabel("Tag").selectOption("");
    await page.getByLabel("File").selectOption("e2e/about.e2e.ts");
    await expectCount(rows, 2);
    await page.getByRole("button", { name: "Failed (2)" }).click();
    await expectCount(rows, 1);
    expect(page.url()).toContain("status=failed");
    expect(page.url()).toContain("file=e2e%2Fabout.e2e.ts");

    await rows.first().click();
    const details = page.getByRole("region", { name: "Test details" });
    await expectText(details.getByRole("heading", { level: 2 }), "has the wrong title on purpose");
    expect(await details.innerText()).toContain('Expected: "Not the about page"');
    const screenshot = details.getByRole("img", { name: "screenshot" });
    await screenshot.waitFor();
    expect(await screenshot.evaluate((image: HTMLImageElement) => image.decode().then(() => image.naturalWidth))).toBeGreaterThan(0);
    expect(await details.getByRole("link", { name: "trace" }).getAttribute("href")).toMatch(/^data\/[0-9a-f]+\.zip$/);
    expect(outside).toEqual([]);
  } finally {
    await page.close();
  }
});

test("show-report serves the last report", async () => {
  const child = spawn(process.execPath, [cliPath, "show-report", "--port", "0", "--no-open"], { cwd: basic });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = /Serving the report at (\S+)/.exec(output);
        if (match) resolve(match[1]!);
      });
      child.on("exit", () => reject(new Error(output)));
    });
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>Intelliwright report</title>");
  } finally {
    child.kill();
  }
});

async function expectText(locator: import("playwright-core").Locator, text: string): Promise<void> {
  await locator.waitFor();
  expect((await locator.innerText()).trim()).toBe(text);
}

async function expectCount(locator: import("playwright-core").Locator, count: number): Promise<void> {
  for (let i = 0; i < 50 && (await locator.count()) !== count; i++) await new Promise((r) => setTimeout(r, 20));
  expect(await locator.count()).toBe(count);
}
