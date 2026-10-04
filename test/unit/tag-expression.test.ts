import { describe, expect, test } from "vitest";
import { parseTagExpression } from "../../src/runner/tag-expression.js";

const matches = (expression: string, tags: string[]): boolean => parseTagExpression(expression)(tags);

describe("parseTagExpression", () => {
  test("matches a single tag, case-insensitively", () => {
    expect(matches("@smoke", ["@smoke", "@auth"])).toBe(true);
    expect(matches("@Smoke", ["@smoke"])).toBe(true);
    expect(matches("@smoke", ["@auth"])).toBe(false);
  });

  test("and, or and not", () => {
    expect(matches("@smoke and @auth", ["@smoke", "@auth"])).toBe(true);
    expect(matches("@smoke and @auth", ["@smoke"])).toBe(false);
    expect(matches("@smoke or @auth", ["@auth"])).toBe(true);
    expect(matches("not @slow", ["@smoke"])).toBe(true);
    expect(matches("not @slow", ["@slow"])).toBe(false);
    expect(matches("not not @slow", ["@slow"])).toBe(true);
  });

  test("not binds tighter than and, which binds tighter than or", () => {
    // @a or (@b and (not @c))
    expect(matches("@a or @b and not @c", ["@a", "@c"])).toBe(true);
    expect(matches("@a or @b and not @c", ["@b", "@c"])).toBe(false);
    expect(matches("@a or @b and not @c", ["@b"])).toBe(true);
  });

  test("parentheses group", () => {
    expect(matches("(@a or @b) and not @c", ["@b"])).toBe(true);
    expect(matches("(@a or @b) and not @c", ["@a", "@c"])).toBe(false);
    expect(matches("not (@a or @b)", ["@c"])).toBe(true);
    expect(matches("((@a))", ["@a"])).toBe(true);
  });

  test("keywords are case-insensitive", () => {
    expect(matches("@a AND NOT @b", ["@a"])).toBe(true);
  });

  test.each([
    ["", 'Invalid tag expression "": it is empty at the end.'],
    ["@smoke and", 'Invalid tag expression "@smoke and": expected a tag at the end.'],
    ["smoke", 'Invalid tag expression "smoke": expected a tag such as @smoke but found "smoke" at position 1.'],
    ["(@a or @b", 'Invalid tag expression "(@a or @b": expected ")" at the end.'],
    ["@a @b", 'Invalid tag expression "@a @b": unexpected "@b" at position 4.'],
    ["@a or )", 'Invalid tag expression "@a or )": expected a tag such as @smoke but found ")" at position 7.'],
  ])("rejects %j", (expression, message) => {
    expect(() => parseTagExpression(expression)).toThrow(message);
  });
});
