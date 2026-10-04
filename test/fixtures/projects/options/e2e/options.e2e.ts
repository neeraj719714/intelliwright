import { expect, test } from "intelliwright";

const it = test.extend<{ greeting: string; page: import("intelliwright").TestFixtures["page"] }>({
  greeting: async ({ baseURL }, provide) => provide(`hello ${baseURL}`),
  page: async ({ page }, provide) => {
    await page.setExtraHTTPHeaders({ "x-fixture": "wrapped" });
    await provide(page);
  },
});

test("globalSetup ran before the workers started", () => {
  expect(process.env.GLOBAL_SETUP_RAN).toBe("yes");
});

test("use sets the viewport and locale", async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 800, height: 600 });
  expect(await page.evaluate(() => navigator.language)).toBe("fr-FR");
});

test("getByTestId uses testIdAttribute", async ({ page }) => {
  await page.setContent('<button data-test="save">Save</button>');
  expect(await page.getByTestId("save").textContent()).toBe("Save");
});

test.describe("with test.use", () => {
  test.use({ viewport: { width: 400, height: 300 } });

  test("overrides the viewport", async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: 400, height: 300 });
  });
});

test("--base-url replaces baseURL and skips the web server", async ({ page, baseURL }) => {
  expect(baseURL).toBe(process.env.EXPECTED_BASE_URL);
  await page.goto("/about.html");
  expect(await page.title()).toBe("About");
});

it("custom fixtures receive built-in ones and can wrap them", async ({ greeting, page }) => {
  expect(greeting).toBe(`hello ${process.env.EXPECTED_BASE_URL}`);
  await page.goto("/");
  expect(await page.title()).toBe("Fixture Home");
});

it.describe("steps and hooks", () => {
  const order: string[] = [];
  it.beforeAll(() => {
    order.push("beforeAll");
  });
  it.beforeEach(({ greeting }) => {
    order.push(`beforeEach ${greeting.split(" ")[0]}`);
  });

  it("run in order", async () => {
    await test.step("a step", async () => {
      order.push("step");
    });
    expect(order).toEqual(["beforeAll", "beforeEach hello", "step"]);
  });
});
