import { expect, test } from "intelliwright";

test("ai actions reach the intended elements", async ({ page, ai }) => {
  const label = process.env.BUTTON_LABEL;
  await page.goto(`/actions.html${label ? `?label=${encodeURIComponent(label)}` : ""}`);
  const status = page.getByRole("status");

  await ai.click("the Sign in button in the header");
  await expect(status).toHaveText("clicked sign in");

  await ai.fill("the email address field", "jane@example.com");
  expect(await page.getByLabel("Email address").inputValue()).toBe("jane@example.com");

  await ai.select("the plan select box", "pro");
  expect(await page.getByLabel("Plan").inputValue()).toBe("pro");

  await ai.check("the terms checkbox");
  expect(await page.getByLabel("I agree to the terms").isChecked()).toBe(true);

  await ai.hover("the more options button");
  await expect(status).toHaveText("hovered more");

  const submit = await ai.locate("the button that submits the newsletter form");
  await submit.click();
  await expect(status).toHaveText("subscribed jane@example.com to pro with terms");
});
