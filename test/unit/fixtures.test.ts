import { describe, expect, test } from "vitest";
import { FixtureScope, parameterNames, toLayer, type FixtureLayer } from "../../src/runner/fixtures.js";
import type { TestInfo } from "../../src/runner/types.js";

const testInfo = {} as TestInfo;

describe("parameterNames", () => {
  test.each([
    ["an arrow function", async ({ page, ai }: any) => [page, ai], ["page", "ai"]],
    ["a function expression", async function ({ context }: any) { return context; }, ["context"]],
    ["renamed and defaulted names", ({ page: p, baseURL = "x" }: any) => [p, baseURL], ["page", "baseURL"]],
    ["nested destructuring", ({ data: { a, b } }: any) => [a, b], ["data"]],
    ["no parameters", () => undefined, []],
    ["an empty pattern", ({}: any) => undefined, []],
    ["an unused parameter", (_: unknown) => undefined, []],
  ])("reads %s", (_, fn, names) => {
    expect(parameterNames(fn as (...args: any[]) => unknown, "test")).toEqual(names);
  });

  test("reads method shorthand", () => {
    const fixtures = { loginPage({ page }: any, provide: any) { return provide(page); } };
    expect(parameterNames(fixtures.loginPage, "test")).toEqual(["page"]);
  });

  test("ignores comments", () => {
    const fn = new Function("return async (/* fixtures: */ { page /* , ai */ }, provide) => provide(page)")() as () => unknown;
    expect(parameterNames(fn, "test")).toEqual(["page"]);
  });

  test("rejects a parameter that isn't destructured", () => {
    expect(() => parameterNames((fixtures: unknown) => fixtures, 'Fixture "x"')).toThrow(
      'Fixture "x" must destructure the fixtures it uses, as in async ({ page }) => { ... }. Got "fixtures".',
    );
  });

  test("rejects a rest element", () => {
    expect(() => parameterNames(({ page, ...rest }: any) => [page, rest], "test")).toThrow(/rest element/);
  });
});

describe("FixtureScope", () => {
  test("sets up dependencies first and tears down in reverse", async () => {
    const events: string[] = [];
    const builtins: FixtureLayer = toLayer({
      db: async ({}, provide: (v: string) => Promise<void>) => {
        events.push("db up");
        await provide("db");
        events.push("db down");
      },
    });
    const layer = toLayer({
      repo: async ({ db }: { db: string }, provide: (v: string) => Promise<void>) => {
        events.push("repo up");
        await provide(`repo(${db})`);
        events.push("repo down");
      },
      label: "plain value",
    });
    const scope = new FixtureScope(builtins, [layer], testInfo);

    expect(await scope.values(["repo", "label"])).toEqual({ repo: "repo(db)", label: "plain value" });
    expect(await scope.teardown()).toEqual([]);
    expect(events).toEqual(["db up", "repo up", "repo down", "db down"]);
  });

  test("an override receives the fixture it overrides", async () => {
    const base = toLayer({ page: "base page" });
    const override = toLayer({
      page: async ({ page }: { page: string }, provide: (v: string) => Promise<void>) => provide(`wrapped ${page}`),
    });
    const scope = new FixtureScope({}, [base, override], testInfo);
    expect(await scope.values(["page"])).toEqual({ page: "wrapped base page" });
  });

  test("sets up a shared dependency once", async () => {
    let setups = 0;
    const layer = toLayer({
      shared: async ({}, provide: (v: number) => Promise<void>) => provide(++setups),
      a: async ({ shared }: { shared: number }, provide: (v: number) => Promise<void>) => provide(shared),
      b: async ({ shared }: { shared: number }, provide: (v: number) => Promise<void>) => provide(shared),
    });
    const scope = new FixtureScope({}, [layer], testInfo);
    expect(await scope.values(["a", "b"])).toEqual({ a: 1, b: 1 });
    expect(setups).toBe(1);
  });

  test("reports a fixture that never calls provide", async () => {
    const scope = new FixtureScope({}, [toLayer({ lazy: async () => {} })], testInfo);
    await expect(scope.values(["lazy"])).rejects.toThrow('Fixture "lazy" finished without calling provide(value).');
  });

  test("reports unknown fixtures and loops", async () => {
    const layer = toLayer({
      a: async ({ b }: any, provide: any) => provide(b),
      b: async ({ a }: any, provide: any) => provide(a),
      c: async ({ missing }: any, provide: any) => provide(missing),
    });
    await expect(new FixtureScope({}, [layer], testInfo).values(["c"])).rejects.toThrow(
      'Unknown fixture "missing", needed by "c". Add it with test.extend().',
    );
    await expect(new FixtureScope({}, [layer], testInfo).values(["a"])).rejects.toThrow(
      "Fixtures depend on each other in a loop: a -> b -> a.",
    );
  });

  test("collects teardown errors", async () => {
    const layer = toLayer({
      broken: async ({}, provide: (v: number) => Promise<void>) => {
        await provide(1);
        throw new Error("cleanup failed");
      },
    });
    const scope = new FixtureScope({}, [layer], testInfo);
    await scope.values(["broken"]);
    const errors = await scope.teardown();
    expect(errors.map((error) => (error as Error).message)).toEqual(["cleanup failed"]);
  });
});
