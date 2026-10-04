---
title: Providers
description: Connect to Jev through TypeSafe, Vercel AI Gateway, OpenRouter, Cloudflare Workers AI, another host, your own function, the AI SDK, or a local mock.
---

Intelliwright talks to Jev through its own small client, so you set one API key and nothing else. Pick a provider with `ai.provider` in the config, or leave it out and Intelliwright uses the first provider whose key it finds in the environment.

## Presets

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: { provider: "typesafe" },
});
```

| Preset | Environment variables | Default model | Tokens per request |
| --- | --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `jev-latest` | 64,000, of which the page and the longest question may use 32,000 |
| `vercel` | `AI_GATEWAY_API_KEY`, or `VERCEL_OIDC_TOKEN` | `typesafe-ai/jev` | 32,000 |
| `openrouter` | `OPENROUTER_API_KEY` | `~typesafe/jev-latest` | 32,000 |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | `typesafe/jev` | 32,000 |

With no `provider` set, Intelliwright checks for keys in the order of this table and uses the first preset whose key is set. Keys are read from the environment, which includes `.env.local` and `.env` in the config's folder. Pass `apiKey` to set one directly.

## Settings

These go next to `provider` in `ai`:

| Setting | Default | What it does |
| --- | --- | --- |
| `model` | The preset's model | Overrides the model, for example to pin `jev-1.13.0`. |
| `apiKey` | From the environment | Overrides the key. |
| `baseURL` | The preset's URL | Sends requests somewhere else, for example through a proxy. |
| `fetch` | Node's `fetch` | A custom `fetch`, for example one that goes through a corporate proxy. |
| `timeout` | 30,000 | Milliseconds per attempt. |
| `maxRetries` | 3 | Retries for timeouts, network errors, 408, 429 and 5xx responses. |
| `maxConcurrency` | 4 | The most requests in flight per worker. |

Aliases such as `jev-latest` move when TypeSafe ships a new version. Reports record the version that answered, such as `jev-1.13.0`; pin it with `model` if you tune thresholds.

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: {
    provider: "typesafe",
    model: "jev-1.13.0",
    maxConcurrency: 2,
  },
});
```

## Another host

Any host that implements TypeSafe's System One API works: `POST {baseURL}/v1/systemone` with `{ model, state, questions }` and a Bearer key.

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: {
    provider: {
      baseURL: "https://jev.internal.example.com",
      apiKey: process.env.JEV_API_KEY,
      model: "jev-latest",
      name: "Internal Jev",
      headers: { "x-team": "qa" },
    },
  },
});
```

`name` is shown in errors and reports, and defaults to the host name. Requests to a custom host may use up to 32,000 tokens.

## Your own function

For anything else, pass an object with an `evaluate` function. It receives the page state and the questions, and returns the answers:

```ts title="intelliwright.config.ts"
export default defineConfig({
  ai: {
    provider: {
      name: "my-evaluator",
      maxInputTokens: 32_000,
      async evaluate({ state, questions }, { signal }) {
        const response = await fetch("https://evaluator.example.com/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state, questions }),
          signal,
        });
        return await response.json(); // { answers, model?, usage?, costUsd? }
      },
    },
  },
});
```

Answers use Intelliwright's shapes: `{ type: "boolean", probability }`, `{ type: "choice", choice, probabilities }` and `{ type: "score", score, probabilities }`. They're checked: every question needs an answer of its type, probabilities must be between 0 and 1, and a choice must be one of the options sent. `model`, `usage` (`inputTokens` and `outputTokens`) and `costUsd` are optional.

## The AI SDK

Projects that already use the Vercel AI SDK can pass any AI SDK evaluation model. Install `ai` 7.x first; Intelliwright doesn't load it unless you import the adapter.

```bash
npm install --save-dev ai
```

```ts title="intelliwright.config.ts"
import { defineConfig } from "intelliwright";
import { fromAiSdk } from "intelliwright/ai-sdk";

export default defineConfig({
  ai: { provider: fromAiSdk("typesafe-ai/jev") },
});
```

A model id string goes through the AI SDK's default provider, which is the Vercel AI Gateway unless you set another. You can also pass an evaluation model object from an AI SDK provider package.

| Option | Default | What it does |
| --- | --- | --- |
| `name` | The model's provider and id | Shown in errors and reports. |
| `maxInputTokens` | 32,000 | The most input tokens one request may use. |
| `maxRetries` | 2 | Retries, made by the AI SDK. |
| `headers` | | Extra request headers. |
| `providerOptions` | | Passed through to the AI SDK. |

A model that answers a choice or a score without probabilities counts as certain of its answer.

## A mock for offline runs

`createMockEvaluator(handler)` from `intelliwright/testing` answers questions locally, with no key and no network. The handler receives each request, `{ state, questions }`, and returns an answer for every question key. Shorthands keep handlers short: `true`, `false` or a probability for a boolean, an option key for a choice, and a level number for a score. Full answer objects work too. The mock's `calls` lists every request it answered, and `reset()` clears it.

```ts title="intelliwright.config.ts"
import { defineConfig } from "intelliwright";
import { createMockEvaluator } from "intelliwright/testing";

const offline = createMockEvaluator(({ questions }) =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]) => {
      if (question.type === "boolean") return [key, key !== "loading"];
      if (question.type === "choice") return [key, Object.keys(question.criteria)[0]];
      return [key, question.criteria.length - 1];
    }),
  ),
);

export default defineConfig({
  ai: { provider: process.env.TYPESAFE_API_KEY ? "typesafe" : offline },
});
```

A mock can't tell whether the page is right. This one says yes to every claim and never sees a loading page, so positive checks pass, `.not` checks fail, and `ai.run` reports its goal as reached before doing anything. Tailor the handler to the questions your tests ask, or, often simpler, tag the tests that use Jev, such as `@ai`, and leave them out with `--tag "not @ai"` where there's no key.
