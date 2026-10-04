import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseStack, userFrame } from "../../src/runner/location.js";

const stack = [
  "Error: boom",
  "    at /app/e2e/login.e2e.ts:3:25",
  "    at Object.<anonymous> (/app/e2e/pages/login.page.ts:12:7)",
  "    at async LoginPage.submit (/app/e2e/pages/My (Old) Pages/x.ts:4:1)",
  "    at file:///app/e2e/esm.e2e.mjs:8:2",
  "    at new Promise (<anonymous>)",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)",
  "    at run (/app/node_modules/intelliwright/dist/worker.js:200:3)",
].join("\n");

describe("parseStack", () => {
  test("reads frames with and without a function name", () => {
    expect(parseStack(stack)).toEqual([
      { file: path.normalize("/app/e2e/login.e2e.ts"), line: 3, column: 25 },
      { file: path.normalize("/app/e2e/pages/login.page.ts"), line: 12, column: 7 },
      { file: path.normalize("/app/e2e/pages/My (Old) Pages/x.ts"), line: 4, column: 1 },
      { file: path.normalize("/app/e2e/esm.e2e.mjs"), line: 8, column: 2 },
      { file: path.normalize("/app/node_modules/intelliwright/dist/worker.js"), line: 200, column: 3 },
    ]);
  });

  test("userFrame skips node_modules and files outside the project", () => {
    const outside = "Error\n    at x (/elsewhere/a.ts:1:1)\n    at y (/app/node_modules/z/index.js:1:1)\n    at z (/app/e2e/b.e2e.ts:5:9)";
    expect(userFrame(outside, "/app")).toEqual({ file: path.normalize("/app/e2e/b.e2e.ts"), line: 5, column: 9 });
  });
});
