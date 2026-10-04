import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const project = path.join(projectsDir, "actions");

describe.skipIf(!process.env.TYPESAFE_API_KEY)("plain-English actions against TypeSafe", () => {
  test("Jev picks the intended element for every action", async () => {
    linkIntelliwright(project);
    const run = await runCli(["test", "--reporter", "json", "--grep", "intended elements", "--update-cache"], {
      cwd: project,
      env: { LIVE: "1", FIXTURE_PORT: String(await freePort()) },
    });
    const results = JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as {
      tests: Array<{ outcome: string; attempts: Array<{ errors: Array<{ message: string }>; ai?: { usage: { calls: number } } }> }>;
    };
    const [result] = results.tests;
    expect(result!.attempts.at(-1)!.errors.map((error) => error.message)).toEqual([]);
    expect(result!.outcome).toBe("passed");
    expect(result!.attempts.at(-1)!.ai!.usage.calls).toBe(6);
    expect(run.code).toBe(0);
  });
});
