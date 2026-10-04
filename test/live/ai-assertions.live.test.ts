import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { linkIntelliwright, projectsDir, runCli } from "../helpers/cli.js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const project = path.join(projectsDir, "ai-live");

describe.skipIf(!process.env.TYPESAFE_API_KEY)("AI assertions against TypeSafe", () => {
  test("a true claim about a fixture page passes, and a false one fails", async () => {
    linkIntelliwright(project);
    const run = await runCli(["test"], { cwd: project });
    const results = JSON.parse(readFileSync(path.join(project, "test-results", "results.json"), "utf8")) as {
      tests: Array<{ titlePath: string[]; outcome: string; attempts: Array<{ errors: Array<{ message: string }> }> }>;
      ai: { provider: string; usage: { calls: number; models: string[] } };
    };
    const outcome = (title: string) => results.tests.find((test) => test.titlePath.at(-1) === title)!;

    expect(outcome("a true claim passes").outcome).toBe("passed");
    expect(outcome("a false claim fails").outcome).toBe("failed");
    expect(outcome("a false claim fails").attempts[0]!.errors[0]!.message).toMatch(/Probability: 0\.\d\d, needed at least 0\.70/);
    expect(results.ai.provider).toBe("TypeSafe");
    expect(results.ai.usage.models[0]).toMatch(/^jev-/);
    expect(run.stdout).toMatch(/Jev {2}TypeSafe \(jev-[\d.]+\): \d+ calls?, [\d,]+ input tokens, \$[\d.]+ \(estimated\)/);
  });
});
