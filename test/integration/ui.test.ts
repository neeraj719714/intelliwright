import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { closeTestBrowser, testBrowser } from "../helpers/browser.js";
import { cliPath, freePort, isUp, linkIntelliwright, projectsDir } from "../helpers/cli.js";

const basic = path.join(projectsDir, "basic");
const WELCOME = "e2e/home.e2e.ts › home page › shows the welcome heading";
const WRONG_TITLE = "e2e/about.e2e.ts › has the wrong title on purpose";
const OUT_OF_TIME = "e2e/timing.e2e.ts › runs out of time";
const EARLIER = "e2e/gone.e2e.ts › failed in an earlier run";

interface Attempt {
  status: string;
  attachments: Array<{ name: string; path?: string }>;
}
interface Shown {
  id: string;
  title: string;
  outcome: string;
  attempts: Attempt[];
}
interface State {
  status: string;
  errors: Array<{ message: string }>;
  tests: Shown[];
}
interface UiEvent {
  type: string;
  status?: string;
  testId?: string;
  state?: State;
}

interface Ui {
  child: ChildProcess;
  url: string;
  exited: Promise<number | null>;
  /** Everything it printed so far. */
  output(): string;
}

function startUi(cwd: string, env: Record<string, string> = {}): Promise<Ui> {
  const child = spawn(process.execPath, [cliPath, "test", "--ui", "--port", "0", "--no-open"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = /UI mode is running at (\S+)/.exec(output);
      if (match) resolve({ child, url: match[1]!, exited, output: () => output });
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    void exited.then(() => reject(new Error(`UI mode exited before it started:\n${output}`)));
  });
}

/** Ends UI mode without letting it clean up, along with its web server and workers. */
async function killUi(ui: Ui | undefined): Promise<void> {
  if (!ui || ui.child.exitCode !== null || ui.child.signalCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(ui.child.pid), "/T", "/F"]);
  else ui.child.kill("SIGKILL");
  await ui.exited;
}

/** Reads the event stream, and waits for events in the order they arrive. */
function listen(url: string) {
  const seen: UiEvent[] = [];
  const controller = new AbortController();
  void fetch(new URL("/api/events", url), { signal: controller.signal })
    .then(async (response) => {
      let buffer = "";
      for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, end);
          if (block.startsWith("data: ")) seen.push(JSON.parse(block.slice("data: ".length)) as UiEvent);
          buffer = buffer.slice(end + 2);
        }
      }
    })
    .catch(() => {});
  let cursor = 0;
  return {
    async next(match: (event: UiEvent) => boolean): Promise<UiEvent> {
      for (const deadline = Date.now() + 60_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 20))) {
        const index = seen.findIndex((event, i) => i >= cursor && match(event));
        if (index !== -1) {
          cursor = index + 1;
          return seen[index]!;
        }
      }
      throw new Error(`No matching event. Seen: ${seen.map((event) => event.type).join(", ")}`);
    },
    close: () => controller.abort(),
  };
}

const runEnded = (event: UiEvent): boolean => event.type === "run" && event.status !== "running";

async function post(url: string, route: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(new URL(route, url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function state(url: string): Promise<State> {
  return (await (await fetch(new URL("/api/tests", url))).json()) as State;
}

describe("UI mode on the basic project", () => {
  let siteURL: string;
  let ui: Ui;
  let events: ReturnType<typeof listen>;
  const lastRun = (): { status: string; failedTests: string[] } =>
    JSON.parse(readFileSync(path.join(basic, "test-results", ".last-run.json"), "utf8"));

  beforeAll(async () => {
    linkIntelliwright(basic);
    const port = await freePort();
    siteURL = `http://127.0.0.1:${port}`;
    mkdirSync(path.join(basic, "test-results"), { recursive: true });
    writeFileSync(path.join(basic, "test-results", ".last-run.json"), JSON.stringify({ status: "failed", failedTests: [WELCOME, EARLIER] }));
    ui = await startUi(basic, { FIXTURE_PORT: String(port) });
    events = listen(ui.url);
  });

  afterAll(async () => {
    events?.close();
    await killUi(ui);
    await closeTestBrowser();
  });

  test("lists the tests and starts the web server before anything runs", async () => {
    const shown = await state(ui.url);
    expect(shown.status).toBe("ready");
    expect(shown.tests.find((test) => test.id === WELCOME)).toMatchObject({ outcome: "notRun", attempts: [] });
    expect(await isUp(siteURL)).toBe(true);
  });

  test("runs one test at a time, and merges its result into the last run", async () => {
    expect((await post(ui.url, "/api/run", { testIds: [WELCOME] })).status).toBe(202);
    expect((await post(ui.url, "/api/run", { testIds: [WELCOME] })).status).toBe(409);
    expect((await events.next(runEnded)).status).toBe("passed");

    const welcome = (await state(ui.url)).tests.find((test) => test.id === WELCOME)!;
    expect(welcome.outcome).toBe("passed");
    expect(welcome.attempts.map((attempt) => attempt.status)).toEqual(["passed"]);
    expect(lastRun()).toEqual({ status: "failed", failedTests: [EARLIER] });
  });

  test("serves a failing test's screenshot, and nothing outside the output folder", async () => {
    expect((await post(ui.url, "/api/run", { testIds: [WRONG_TITLE] })).status).toBe(202);
    expect((await events.next(runEnded)).status).toBe("failed");

    const failed = (await state(ui.url)).tests.find((test) => test.id === WRONG_TITLE)!;
    expect(failed.outcome).toBe("failed");
    const screenshot = failed.attempts.at(-1)!.attachments.find((attachment) => attachment.name === "screenshot")!;
    expect(screenshot.path).toMatch(/^\/artifacts\/e2e-about-e2e-has-the-wrong-title-on-purpose-[0-9a-f]{6}-retry1\/screenshot\.png\?v=\d+$/);
    const image = await fetch(new URL(screenshot.path!, ui.url));
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    expect((await fetch(new URL("/artifacts/..%2fintelliwright.config.ts", ui.url))).status).toBe(404);
    expect(lastRun().failedTests).toEqual([EARLIER, WRONG_TITLE]);
  });

  test("Stop leaves the test it cut short as it was before the run", async () => {
    expect((await post(ui.url, "/api/run", { testIds: [OUT_OF_TIME] })).status).toBe(202);
    await events.next((event) => event.type === "testBegin" && event.testId === OUT_OF_TIME);
    expect(await (await post(ui.url, "/api/stop", {})).json()).toEqual({ stopped: true });
    expect((await events.next(runEnded)).status).toBe("interrupted");

    expect((await state(ui.url)).tests.find((test) => test.id === OUT_OF_TIME)).toMatchObject({ outcome: "notRun", attempts: [] });
    expect(lastRun().failedTests).toEqual([EARLIER, WRONG_TITLE]);
  });

  test("refuses requests from other sites", async () => {
    const crossSite = await post(ui.url, "/api/run", { testIds: [WELCOME] }, { origin: "http://evil.example" });
    expect(crossSite.status).toBe(403);
    const { port, hostname } = new URL(ui.url);
    const rebound = await new Promise<number | undefined>((resolve, reject) => {
      request({ hostname, port, path: "/api/tests", headers: { host: `evil.example:${port}` } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
        .on("error", reject)
        .end();
    });
    expect(rebound).toBe(403);
  });

  test("the page runs a test and shows its result as it arrives", async () => {
    const page = await (await testBrowser()).newPage();
    try {
      await page.goto(ui.url);
      const row = page.getByTestId("test-row").filter({ hasText: "shows the about heading" });
      await row.waitFor();
      expect(await row.getAttribute("data-outcome")).toBe("notRun");

      await page.getByRole("button", { name: "Run shows the about heading", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Intelliwright UI · passed" }).waitFor();
      expect(await row.getAttribute("data-outcome")).toBe("passed");
      const details = page.getByRole("region", { name: "Test details" });
      expect((await details.getByRole("heading", { level: 2 }).innerText()).trim()).toBe("shows the about heading");
      await details.getByText("beforeEach hook").waitFor();
      expect(await page.getByRole("button", { name: "Run all" }).isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("a reload keeps UI mode running, and closing its last page stops it and the web server it started", async () => {
    events.close();
    const reloaded = listen(ui.url);
    await reloaded.next((event) => event.type === "tests");
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(ui.child.exitCode).toBeNull();

    reloaded.close();
    expect(await ui.exited).toBe(0);
    expect(ui.output()).toContain("The page was closed, so UI mode is stopping.");
    expect(await isUp(siteURL)).toBe(false);
  });
});

describe("UI mode reloads the list when test files change", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "intelliwright-ui-"));
  const file = path.join(scratch, "e2e", "math.e2e.ts");
  const write = (body: string): void => writeFileSync(file, `import { expect, test } from "intelliwright";\n${body}\n`);
  let ui: Ui;
  let events: ReturnType<typeof listen>;

  beforeAll(async () => {
    mkdirSync(path.join(scratch, "e2e"));
    writeFileSync(path.join(scratch, "intelliwright.config.ts"), "export default { testDir: \"e2e\", workers: 1 };\n");
    write('test("adds", () => { expect(1 + 1).toBe(2); });');
    linkIntelliwright(scratch);
    ui = await startUi(scratch);
    events = listen(ui.url);
  });

  afterAll(async () => {
    events?.close();
    await killUi(ui);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
  });

  const listed = (event: UiEvent): string[] => event.state!.tests.map((test) => `${test.title}: ${test.outcome}`);
  // One save can reach the watcher more than once, so wait for the list a change leads to.
  const reloaded = (match: (state: State) => boolean) => (event: UiEvent) => event.type === "tests" && match(event.state!);

  test("a new test shows up, and running it after an edit runs the new code", async () => {
    expect(listed(await events.next((event) => event.type === "tests"))).toEqual(["adds: notRun"]);

    write('test("adds", () => { expect(1 + 1).toBe(3); });\ntest("subtracts", () => { expect(2 - 1).toBe(1); });');
    const added = await events.next(reloaded((shown) => shown.tests.length === 2));
    expect(listed(added)).toEqual(["adds: notRun", "subtracts: notRun"]);

    expect((await post(ui.url, "/api/run", { testIds: ["e2e/math.e2e.ts › adds"] })).status).toBe(202);
    expect((await events.next(runEnded)).status).toBe("failed");
    expect((await state(ui.url)).tests.map((test) => `${test.title}: ${test.outcome}`)).toEqual(["adds: failed", "subtracts: notRun"]);
  });

  test("a file that stops loading keeps its tests and shows the error", async () => {
    write('test("adds", () => {');
    const broken = await events.next(reloaded((shown) => shown.errors.length > 0));
    expect(broken.state!.errors.map((error) => error.message)).toEqual([expect.stringContaining("Couldn't load")]);
    expect(listed(broken)).toEqual(["adds: failed", "subtracts: notRun"]);
  });

  // On Windows, kill() can't send Ctrl+C: it ends the process at once.
  test.skipIf(process.platform === "win32")("Ctrl+C stops UI mode while its page is open, and exits with 0", async () => {
    ui.child.kill("SIGINT");
    expect(await ui.exited).toBe(0);
    expect(ui.output()).not.toContain("The page was closed");
  });
});
