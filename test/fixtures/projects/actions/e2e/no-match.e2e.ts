import { test } from "intelliwright";

test("an action with no matching element lists the best candidates", { tag: "@expected-failure" }, async ({ page, ai }) => {
  await page.goto("/actions.html");
  await ai.click("the shopping cart icon");
});
