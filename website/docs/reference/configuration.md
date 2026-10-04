---
title: Configuration
description: Every option in intelliwright.config.ts, with its type and default.
---

The config lives in `intelliwright.config.ts` at the project root, and exports a config object, typed with `defineConfig`:

```ts title="intelliwright.config.ts"
import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "./e2e",
  baseURL: "http://localhost:3000",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  use: { locale: "en-US", timezoneId: "America/New_York" },
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  ai: {
    provider: "typesafe",
    redact: [/\b\d{4}(?: \d{4}){3}\b/],
  },
  suites: {
    smoke: "@smoke",
    nightly: "@regression or @slow",
  },
  reporters: ["terminal", "html", "junit"],
});
```

## The config file

- Intelliwright looks in the current folder for `intelliwright.config.ts`, then `.mts`, `.cts`, `.js`, `.mjs` and `.cjs`. `--config <file>` picks another.
- The config's folder is the project root: relative paths in the config resolve against it, and `.env.local` and then `.env` are loaded from it before the config. Variables that are already set aren't overwritten.
- The file can be TypeScript or JavaScript, an ES module or CommonJS. It's loaded without a build step.
- Without a config file, the defaults below apply, with the current folder as the root.

## Tests

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `testDir` | `string` | `"e2e"` | The folder with the tests. |
| `testMatch` | `string \| string[]` | `"**/*.e2e.{ts,js,mts,mjs,cts,cjs}"` | Globs for test files, relative to `testDir`. |
| `testIgnore` | `string \| string[]` | `[]` | Globs for files to leave out. They apply to setup files too. |
| `outputDir` | `string` | `"test-results"` | Where failure artifacts and the last run's state go. Cleared at the start of each run. |

Files in `testDir` named `*.setup.{ts,mts,cts,js,mjs,cjs}` hold [sign-ins](../writing-tests/signing-in.md) and are never test files.

## The app

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseURL` | `string` | | Relative URLs in `page.goto`, page objects and `toHaveURL` resolve against it. `--base-url` overrides it. |
| `webServer` | `object \| object[]` | | Starts the app before the tests and stops it afterwards. |
| `globalSetup` | `string` | | A module whose default export runs once before the tests. It receives the resolved config and may return a teardown function. |
| `globalTeardown` | `string` | | A module whose default export runs once after all tests. |

`webServer` options:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `command` | `string` | | The shell command that starts the app. |
| `url` | `string` | | Responds with a status from 200 to 403 once the app is ready. |
| `reuseExistingServer` | `boolean` | `false` | Uses a server already responding at `url` instead of starting one. |
| `timeout` | `number` | `60000` | Milliseconds to wait for `url`. |
| `cwd` | `string` | The config's folder | Where `command` runs. |
| `env` | `Record<string, string>` | | Extra environment variables for `command`. |
| `showOutput` | `boolean` | `false` | Prints the server's output. It's shown anyway if the server fails to start. |

See [Starting your app](../running-tests/web-server.md).

## Browser

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `browser` | `"chromium" \| "firefox" \| "webkit"` | `"chromium"` | The browser every test runs in. |
| `launchOptions` | `LaunchOptions` | `{}` | Passed to Playwright's `browserType.launch()`, such as `channel` or `slowMo`. |
| `headless` | `boolean` | `true` | `--headed` turns it off. |
| `use` | `object` | `{}` | Browser context options for every test, described below. `test.use()` sets them for one file or `describe`. |
| `testIdAttribute` | `string` | `"data-testid"` | The attribute `getByTestId` reads, such as `data-test` or `data-cy`. |

`use` takes Playwright's browser context options, such as `viewport`, `locale`, `timezoneId`, `colorScheme`, `permissions`, `geolocation`, `extraHTTPHeaders`, `httpCredentials`, `ignoreHTTPSErrors` and `storageState`, except `baseURL`, which has its own option. It adds:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `actionTimeout` | `number` | No limit | Milliseconds for each action, such as `click`. |
| `navigationTimeout` | `number` | No limit | Milliseconds for each navigation. |
| `auth` | `string \| null` | | Starts tests signed in as this role, with the state `test.auth(role)` saved. `null` starts them signed out. |

## Running

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `workers` | `number` | Half the CPU cores | Worker processes that run test files in parallel. `--workers` overrides it. |
| `retries` | `number` | `0` | Extra attempts for a failing test. `--retries` overrides it. |
| `timeout` | `number` | `30000` | Milliseconds for each test, fixtures and hooks included. `0` means no limit. `--timeout` overrides it. |
| `expect.timeout` | `number` | `5000` | Milliseconds page and AI assertions keep retrying. |
| `suites` | `Record<string, string>` | `{}` | Named tag expressions, run with `--suite <name>`. |

## Jev

Everything under `ai` is optional. Without `provider`, the first provider whose key is set in the environment is used. See [Providers](../jev/providers.md).

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `ai.provider` | Preset name, host or function | Detected from the environment | `"typesafe"`, `"vercel"`, `"openrouter"`, `"cloudflare"`, a `{ baseURL }` host, or an object with an `evaluate` function. |
| `ai.model` | `string` | The preset's model | Overrides the model, for example to pin `jev-1.13.0`. |
| `ai.apiKey` | `string` | From the environment | Overrides the key. |
| `ai.baseURL` | `string` | The preset's URL | Sends requests through another URL, such as a proxy. |
| `ai.fetch` | `typeof fetch` | Node's `fetch` | A custom `fetch`. |
| `ai.timeout` | `number` | `30000` | Milliseconds per request attempt. |
| `ai.maxRetries` | `number` | `3` | Retries for timeouts, network errors, 408, 429 and 5xx responses. |
| `ai.maxConcurrency` | `number` | `4` | The most requests in flight per worker. |
| `ai.minProbability` | `number` | `0.7` | The probability AI assertions and actions need. |
| `ai.cache` | `boolean` | `true` | Caches resolved locators in `.intelliwright/cache.json`. |
| `ai.triage` | `boolean` | `true` | Asks Jev to label failures. |
| `ai.redact` | `Array<RegExp \| string>` | `[]` | Masks text before the page state is sent: regular expressions match text, strings are selectors whose elements' text is masked. |

## Reporting

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `reporters` | `Array<name \| [name, options]>` | `["terminal", "html"]` | Reporters to use: `terminal`, `html`, `json` and `junit`. `--reporter` overrides it. |
| `report.open` | `"on-failure" \| "always" \| "never"` | `"on-failure"` | When the HTML report opens after a local run. It never opens when `CI` is set. |

Reporter options:

| Reporter | Option | Default |
| --- | --- | --- |
| `html` | `outputFolder` | `"intelliwright-report"` |
| `html` | `open` | `report.open` |
| `json` | `outputFile` | `"test-results/results.json"` |
| `junit` | `outputFile` | `"test-results/junit.xml"` |

See [Reports and artifacts](../running-tests/reports.md).

## Files Intelliwright writes

| Path | Commit it? | What it holds |
| --- | --- | --- |
| `test-results/` | No | Failure artifacts, and `.last-run.json` for `--last-failed`. |
| `intelliwright-report/` | No | The last HTML report. |
| `.intelliwright/cache.json` | Yes | Locators resolved by AI actions. |
| `.intelliwright/auth/` | Never | Saved sign-ins, which hold session cookies. |

`intelliwright init` adds the ones that shouldn't be committed to `.gitignore`.
