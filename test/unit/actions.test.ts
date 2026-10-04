import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { LocatorCache } from "../../src/ai/cache.js";
import { rankCandidates, type Candidate } from "../../src/ai/candidates.js";
import { locatorCode } from "../../src/ai/locators.js";

const candidate = (description: string): Candidate => ({
  key: "",
  ref: "e1",
  role: "button",
  name: description,
  text: "",
  landmark: undefined,
  placeholder: undefined,
  url: undefined,
  fillable: false,
  description,
});

describe("rankCandidates", () => {
  test("puts the candidates that share the most words first, then keeps document order", () => {
    const ranked = rankCandidates(
      [candidate('link "Home"'), candidate('button "Save draft"'), candidate('button "Save" in form "Profile"'), candidate('link "Help"')],
      "the save button in the profile form",
    );
    expect(ranked.map((item) => [item.key, item.description])).toEqual([
      ["e0", 'button "Save" in form "Profile"'],
      ["e1", 'button "Save draft"'],
      ["e2", 'link "Home"'],
      ["e3", 'link "Help"'],
    ]);
  });

  test("caps the list for the choice question", () => {
    const many = Array.from({ length: 300 }, (_, i) => candidate(`button "Item ${i}"`));
    expect(rankCandidates(many, "item")).toHaveLength(254);
  });
});

test("locatorCode prints readable Playwright code", () => {
  expect(locatorCode({ kind: "role", role: "button", name: "Sign in" })).toBe("page.getByRole('button', { name: 'Sign in', exact: true })");
  expect(locatorCode({ kind: "role", role: "link", name: "Home", within: { role: "navigation", name: "Main" } })).toBe(
    "page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Home', exact: true })",
  );
  expect(locatorCode({ kind: "role", role: "button", name: "It's on", nth: 1 })).toBe(
    "page.getByRole('button', { name: 'It\\'s on', exact: true }).nth(1)",
  );
  expect(locatorCode({ kind: "testId", value: "save" })).toBe("page.getByTestId('save')");
  expect(locatorCode({ kind: "label", text: "Email" })).toBe("page.getByLabel('Email', { exact: true })");
  expect(locatorCode({ kind: "text", text: "Read more" })).toBe("page.getByText('Read more', { exact: true })");
});

test("the locator cache merges changes from several workers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "intelliwright-cache-"));
  const first = new LocatorCache(root);
  const second = new LocatorCache(root);
  const entry = (name: string) => ({ locator: { kind: "role" as const, role: "button", name }, element: name, updated: "2026-10-04" });

  first.set(LocatorCache.key("http://app.test/a?x=1", "click", "save"), entry("Save"));
  second.set(LocatorCache.key("http://app.test/b", "click", "send"), entry("Send"));
  first.flush();
  second.flush();

  const file = JSON.parse(readFileSync(path.join(root, ".intelliwright", "cache.json"), "utf8"));
  expect(Object.keys(file.entries)).toEqual(["/a click save", "/b click send"]);
  expect(new LocatorCache(root).get("/b click send")?.locator).toEqual({ kind: "role", role: "button", name: "Send" });
});
