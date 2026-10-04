import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
// --import takes a URL; on Windows a bare D:\ path reads as a "d:" scheme.
const hooks = new URL("../helpers/record-imports.mjs", import.meta.url).href;

test("importing intelliwright and intelliwright/testing never loads the AI SDK", () => {
  const output = execFileSync(
    process.execPath,
    ["--import", hooks, "--input-type=module", "-e", 'await import("intelliwright"); await import("intelliwright/testing");'],
    { cwd: root, encoding: "utf8" },
  );
  const resolved = JSON.parse(output.split("__RESOLVED__")[1] ?? "[]") as string[];

  expect(resolved.some((url) => url.endsWith("/dist/index.js"))).toBe(true);
  expect(resolved.some((url) => url.endsWith("/dist/testing.js"))).toBe(true);
  expect(resolved.filter((url) => /\/node_modules\/(ai|@ai-sdk)\//.test(url))).toEqual([]);
});
