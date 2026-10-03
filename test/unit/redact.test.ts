import { describe, expect, test } from "vitest";
import { REDACTED, redactJson, redactText } from "../../src/ai/redact.js";

describe("redaction", () => {
  test("masks pattern matches and exact values", () => {
    const text = "Card 4242 4242 4242 4242, email jane@example.com, password hunter2!";
    expect(
      redactText(text, { patterns: [/\b(?:\d{4} ){3}\d{4}\b/, /[\w.]+@[\w.]+/], values: ["hunter2!"] }),
    ).toBe(`Card ${REDACTED}, email ${REDACTED}, password ${REDACTED}`);
  });

  test("masks every occurrence, longest values first", () => {
    expect(redactText("abc abcdef abc", { values: ["abc", "abcdef"] })).toBe(
      `${REDACTED} ${REDACTED} ${REDACTED}`,
    );
  });

  test("ignores blank values", () => {
    expect(redactText("a b", { values: ["", " "] })).toBe("a b");
  });

  test("masks strings anywhere in a JSON value", () => {
    expect(
      redactJson(
        { url: "https://app.test/?token=s3cret", aria: ["- textbox: s3cret"], count: 2 },
        { values: ["s3cret"] },
      ),
    ).toEqual({ url: `https://app.test/?token=${REDACTED}`, aria: [`- textbox: ${REDACTED}`], count: 2 });
  });
});
