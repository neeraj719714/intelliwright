import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { freePort, linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const project = path.join(projectsDir, "run");

describe.skipIf(!process.env.TYPESAFE_API_KEY)("ai.run against TypeSafe", () => {
  test("Jev completes the signup flow within maxSteps", async () => {
    linkIntelliwright(project);
    await runCli(["test", "--reporter", "json", "--grep", "multi-step signup"], {
      cwd: project,
      env: { LIVE: "1", FIXTURE_PORT: String(await freePort()) },
    });
    const results = JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as {
      tests: Array<{ outcome: string; attempts: Array<{ errors: Array<{ message: string }>; steps: Array<{ title: string }> }> }>;
    };
    const [result] = results.tests;
    expect(result!.attempts.at(-1)!.errors.map((error) => error.message)).toEqual([]);
    expect(result!.outcome).toBe("passed");
  });
});
