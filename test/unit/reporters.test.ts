import { describe, expect, test } from "vitest";
import { formatCost, formatDuration, stripAnsi } from "../../src/reporters/format.js";
import { shouldOpenReport } from "../../src/reporters/open.js";
import { shouldColor } from "../../src/reporters/terminal.js";

describe("shouldOpenReport", () => {
  test("opens after a local failure, or always when asked", () => {
    expect(shouldOpenReport("on-failure", "failed", {})).toBe(true);
    expect(shouldOpenReport("on-failure", "passed", {})).toBe(false);
    expect(shouldOpenReport("always", "passed", {})).toBe(true);
    expect(shouldOpenReport("never", "failed", {})).toBe(false);
  });

  test("never opens in CI", () => {
    expect(shouldOpenReport("always", "failed", { CI: "true" })).toBe(false);
  });
});

describe("shouldColor", () => {
  test("follows NO_COLOR, FORCE_COLOR and the terminal", () => {
    const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
    try {
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;
      expect(shouldColor({ isTTY: true })).toBe(true);
      expect(shouldColor({ isTTY: false })).toBe(false);
      process.env.FORCE_COLOR = "1";
      expect(shouldColor({ isTTY: false })).toBe(true);
      process.env.NO_COLOR = "1";
      expect(shouldColor({ isTTY: true })).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test("formatting helpers", () => {
  expect(formatDuration(450)).toBe("450ms");
  expect(formatDuration(1_234)).toBe("1.2s");
  expect(formatDuration(125_000)).toBe("2m 5s");
  expect(formatCost(0)).toBe("$0");
  expect(formatCost(0.0000229)).toBe("$0.000023");
  expect(formatCost(0.12345)).toBe("$0.1235");
  expect(stripAnsi("\u001b[31mred\u001b[39m plain")).toBe("red plain");
});
