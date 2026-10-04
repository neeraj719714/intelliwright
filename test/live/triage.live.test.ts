import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const project = path.join(projectsDir, "triage");

interface Results {
  tests: Array<{ titlePath: string[]; triage?: { label: string; probability?: number } }>;
}
const read = (): Results => JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8"));

describe.skipIf(!process.env.TYPESAFE_API_KEY)("failure triage against TypeSafe", () => {
  test("a stopped fixture server is labeled environment", async () => {
    linkIntelliwright(project);
    const dead = await freePort();
    await runCli(["test", "--reporter", "json", "--base-url", `http://127.0.0.1:${dead}`, "--grep", "goes to the shop"], {
      cwd: project,
      env: { LIVE: "1" },
    });
    expect(read().tests[0]!.triage?.label).toBe("environment");
  });

  test("Jev labels a regression, a test bug, a timing problem and an unreachable API", async () => {
    await runCli(["test", "--reporter", "json"], {
      cwd: project,
      env: { LIVE: "1", FIXTURE_PORT: String(await freePort()), DEAD_PORT: String(await freePort()) },
    });
    const labels = Object.fromEntries(read().tests.filter((test) => test.triage).map((test) => [test.titlePath.at(-1), test.triage!.label]));
    console.log(JSON.stringify(read().tests.map((test) => [test.titlePath.at(-1), test.triage])));
    expect(labels).toEqual({
      "the cart total adds up every item": "regression",
      "checkout starts from the cart": "test_bug",
      "the slow list shows its item": "flaky",
      "the item list loads from the API": "environment",
    });
  });
});
