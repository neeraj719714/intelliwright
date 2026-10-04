---
title: Asking Jev questions
description: Ask your own yes/no, choice and score questions about a page or element with ai.evaluate.
---

`ai.evaluate(questions, options?)` asks Jev your own typed questions about the current page and returns its answers. Use it when the built-in assertions don't fit, for example to branch on what the page shows or to apply your own threshold.

```ts
const { plan, signedIn, clarity } = await ai.evaluate({
  plan: {
    type: "choice",
    instructions: "Which plan is selected?",
    criteria: { free: "The Free plan", pro: "The Pro plan", team: "The Team plan" },
  },
  signedIn: { type: "boolean", instructions: "Is a user signed in?" },
  clarity: {
    type: "score",
    instructions: "How clearly does the pricing table compare the plans?",
    criteria: ["Confusing", "Somewhat clear", "Clear", "Very clear"],
  },
});

expect(plan.choice).toBe("pro");
expect(signedIn.probability).toBeGreaterThan(0.7);
expect(clarity.score).toBeGreaterThanOrEqual(2);
```

All the questions are answered from the same page state, in one request. Requests too large for the provider are split, and the answers merged.

## Question types

| Type | Question | Answer |
| --- | --- | --- |
| `boolean` | `instructions`, and optionally `criteria: { true, false }` describing what yes and no mean. | `probability`: how likely the answer is yes. |
| `choice` | `instructions`, and `criteria`: an object of options, keyed by name, at most 255. | `choice`: the most likely option, and `probabilities` of every option. |
| `score` | `instructions`, and `criteria`: from 2 to 10 levels, lowest first. | `score`: the probability-weighted level, and `probabilities` of each level. |

Choice and score answers also include `confidence` when the provider returns one. Answers are typed: for a choice, `choice` is one of the option keys.

`instructions` and each option or level can be text or any JSON value, for example an object that spells out details. `null` leaves an option without a description.

```ts
const { severity } = await ai.evaluate({
  severity: {
    type: "choice",
    instructions: { task: "Classify the banner at the top of the page", ignore: "cookie notices" },
    criteria: { info: "Information only", warning: "A warning the user should read", error: "An error that blocks the user" },
  },
});
```

## Asking about one element

Pass `scope` to ask about one element instead of the whole page:

```ts
const { tone } = await ai.evaluate(
  { tone: { type: "choice", instructions: "What tone does the message take?", criteria: { friendly: "Friendly", neutral: "Neutral", blunt: "Blunt" } } },
  { scope: page.getByRole("alert") },
);
```

## In the report

`ai.evaluate` is a step in the report, and each question is listed under AI decisions with its answer and probability.
