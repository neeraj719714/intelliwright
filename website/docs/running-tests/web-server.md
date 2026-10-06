---
title: Starting your app
description: Start the app with webServer, run against another environment with --base-url, load environment variables, and run code before and after the suite.
---

Intelliwright tests anything reachable over HTTP: a Next.js or Vite dev server, a Rails app, a static site, or a deployed URL.

## baseURL

```ts title="intelliwright.config.ts"
export default defineConfig({
  baseURL: "http://localhost:3000",
});
```

With `baseURL` set, tests and page objects use paths: `page.goto("/notes")`, a page object's `path = "/notes"`, and `expect(page).toHaveURL("/notes")`. It's also the origin that [`ai.run`](../jev/goals.md#staying-on-your-site) stays on.

## webServer

`webServer` starts the app before the tests and stops it when they're done:

```ts title="intelliwright.config.ts"
export default defineConfig({
  baseURL: "http://localhost:3000",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `command` | | The shell command that starts the app. |
| `url` | | A URL that responds once the app is ready. |
| `reuseExistingServer` | `false` | Uses a server already running at `url` instead of starting one. Without it, a busy `url` is an error. |
| `timeout` | 60000 | Milliseconds to wait for `url` to respond. |
| `cwd` | The config's folder | Where `command` runs. |
| `env` | | Extra environment variables for `command`. |
| `showOutput` | `false` | Prints the server's output. It's always shown when the server fails to start. |

- The app counts as ready when `url` answers with a status from 200 to 403.
- `webServer` can be an array, to start several servers, such as an API and a front end.
- A common setup is `reuseExistingServer: !process.env.CI`: locally it reuses your dev server, and in CI it always starts a fresh one.
- Servers that the run started are stopped at the end, with everything they spawned. Servers it reused are left running.
- In [UI mode](selecting-tests.md#ui-mode), servers start once, before the page opens, and stop when you press Ctrl+C.

## Another environment

`--base-url` runs the same suite against another URL, such as a staging site or a preview deployment:

```bash
npx intelliwright test --base-url https://staging.example.com
```

`webServer` entries whose `url` is on a different origin are skipped, so nothing starts locally.

## Environment variables

Before loading the config, Intelliwright loads `.env.local` and then `.env` from the config's folder. A variable that's already set, in your shell or in CI, is never overwritten. Use these files for provider keys and test credentials, and keep them out of git.

## Before and after the suite

`globalSetup` and `globalTeardown` name modules whose default export runs once per run, before the workers start and after the last test:

```ts title="intelliwright.config.ts"
export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
});
```

```ts title="e2e/global-setup.ts"
export default async function globalSetup() {
  await seedDatabase();
  return async () => {
    await clearDatabase();
  };
}
```

Each function receives the resolved config. A function returned by `globalSetup` runs as teardown, before `globalTeardown`. Both run after `webServer` has started the app. In UI mode, they run once for the whole session, not once per run.
