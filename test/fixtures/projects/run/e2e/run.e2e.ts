import { writeFileSync } from "node:fs";
import { expect, test, type RunResult } from "intelliwright";

const failure = (promise: Promise<RunResult>) =>
  promise.then(
    () => undefined,
    (error: { name: string; result: RunResult }) => error,
  );

test("ai.run completes a multi-step signup", async ({ page, ai }) => {
  await page.goto("/signup/");
  const result = await ai.run("create an account on the Pro plan", {
    data: { name: "Jane Doe", email: "jane@example.com" },
    avoid: ["the Delete account button"],
    maxSteps: 8,
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome aboard, Jane Doe!");
  await expect(page.getByText("You are on the Pro plan.")).toBeVisible();
  expect(result.reason).toBe("goal-met");
  expect(result.steps.length).toBeLessThanOrEqual(8);
  if (process.env.CODE_OUT) writeFileSync(process.env.CODE_OUT, result.code);
});

test("ai.run stops at stuck on a dead end instead of looping", async ({ page, ai }) => {
  await page.goto("/signup/dead-end.html");
  const error = await failure(ai.run("finish the signup", { maxSteps: 8 }));
  expect(error?.name).toBe("GoalNotReachedError");
  expect(error!.result.reason).toBe("stuck");
  expect(error!.result.steps.length).toBeLessThanOrEqual(1);
});

test("ai.run never leaves the base URL's origin", async ({ page, ai, baseURL }) => {
  await page.goto("/signup/leaky.html");
  const error = await failure(ai.run("continue to the next page", { maxSteps: 5 }));
  expect(error!.result.reason).toBe("stuck");
  expect(error!.result.blockedNavigations).toEqual(["https://elsewhere.example/next"]);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("ai.run asks for data it doesn't have", async ({ page, ai }) => {
  await page.goto("/signup/");
  const error = await failure(ai.run("create an account on the Pro plan", { avoid: ["the Delete account button"] }));
  expect(error!.result.reason).toBe("missing-data");
  expect(error!.result.detail).toContain('textbox "Full name"');
});

test("a run that can't reach its goal fails the test with its steps", { tag: "@expected-failure" }, async ({ page, ai }) => {
  await page.goto("/signup/dead-end.html");
  await ai.run("finish the signup", { maxSteps: 8 });
});
