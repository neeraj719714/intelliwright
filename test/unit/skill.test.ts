import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const dir = path.resolve(import.meta.dirname, "../../skills/intelliwright");
const skill = readFileSync(path.join(dir, "SKILL.md"), "utf8");

function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error("SKILL.md has no frontmatter.");
  return Object.fromEntries(
    match[1]!.split("\n").map((line) => {
      const colon = line.indexOf(": ");
      return [line.slice(0, colon), line.slice(colon + 2)];
    }),
  );
}

describe("the agent skill", () => {
  test("has valid frontmatter", () => {
    const { name, description, ...rest } = frontmatter(skill);
    expect(Object.keys(rest)).toEqual([]);
    expect(name).toBe(path.basename(dir));
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name!.length).toBeLessThanOrEqual(64);
    expect(description!.length).toBeGreaterThan(0);
    expect(description!.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]|: | #/);
  });

  test("stays under 500 lines", () => {
    expect(skill.split("\n").length).toBeLessThan(500);
  });

  test("links only to files that exist", () => {
    const links = [...skill.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links).toContain("page-objects.md");
    expect(links).toContain("flakiness.md");
    const files = readdirSync(dir);
    for (const link of links) expect(files).toContain(link);
  });

  test("names no particular app or provider, and imports only from intelliwright", () => {
    for (const file of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/buildthisplease|typesafe|vercel|openrouter|cloudflare|@playwright\/test/i);
      for (const [, source] of text.matchAll(/^import .* from "([^"]+)";$/gm)) {
        expect(source === "intelliwright" || source!.startsWith("./"), `${file} imports ${source}`).toBe(true);
      }
    }
  });
});
