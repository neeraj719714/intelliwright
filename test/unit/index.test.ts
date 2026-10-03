import { expect, test } from "vitest";
import { name } from "../../src/index.js";

test("the package entry exports its name", () => {
  expect(name).toBe("intelliwright");
});
