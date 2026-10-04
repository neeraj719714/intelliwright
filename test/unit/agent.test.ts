import { expect, test } from "vitest";
import { describeValue } from "../../src/ai/agent.js";

test("describeValue names the kind of value without revealing it", () => {
  expect(describeValue("jane@example.com")).toBe("an email address");
  expect(describeValue("https://example.com/a")).toBe("a URL");
  expect(describeValue("2026-10-04")).toBe("a date");
  expect(describeValue("42")).toBe("a number");
  expect(describeValue("+1 (555) 010-9999")).toBe("a phone number");
  expect(describeValue("hunter2")).toBe("text, 1 word");
  expect(describeValue("Need a habit tracker")).toBe("text, 4 words");
});
