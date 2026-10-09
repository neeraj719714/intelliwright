---
title: Command line
description: Every intelliwright command and option.
---

Run commands with your package manager's runner, such as `npx intelliwright test`, `pnpm exec intelliwright test`, `yarn intelliwright test` or `bunx intelliwright test`.

| Command | What it does |
| --- | --- |
| [`intelliwright test`](#intelliwright-test) | Runs tests, or with `--ui`, opens UI mode. |
| [`intelliwright init`](#intelliwright-init) | Sets up Intelliwright in a project. |
| [`intelliwright install`](#intelliwright-install) | Downloads browsers. |
| [`intelliwright show-report`](#intelliwright-show-report) | Serves the last HTML report. |

`intelliwright --version` prints the version, and `--help` after any command lists its options.

## intelliwright test

```bash
npx intelliwright test [filters...] [options]
```

Filters are test files or folders. Add `:line` to run the test or `describe` that starts on that line. A filter that isn't an existing path matches test files whose path contains it.

| Option | What it does |
| --- | --- |
| `-c`, `--config <file>` | Uses this config file. |
| `-t`, `--tag <expression>` | Runs tests whose tags match, such as `"@smoke and not @slow"`. |
| `-g`, `--grep <regex>` | Runs tests whose full title matches. |
| `--grep-invert <regex>` | Skips tests whose full title matches. |
| `-s`, `--suite <name>` | Runs a named suite from the config. |
| `--list` | Lists the matching tests without running them. |
| `--last-failed` | Runs only the tests that failed in the previous run. |
| `--headed` | Shows the browser while tests run. |
| `-j`, `--workers <count>` | Number of worker processes, at least 1. |
| `--retries <count>` | Extra attempts for failing tests. |
| `--timeout <ms>` | Milliseconds per test. `0` means no limit. |
| `--reporter <names>` | Comma-separated reporters: `terminal`, `html`, `json`, `junit`. |
| `--base-url <url>` | Runs against this URL instead of the config's `baseURL`. |
| `--update-cache` | Resolves every AI action again instead of using cached locators. |
| `--ui` | Opens [UI mode](../running-tests/selecting-tests.md#ui-mode), a page where you run one test, a file or every listed test, and see steps, errors, screenshots and AI decisions as they happen. The filters decide which tests are listed, and saving a test file reloads the list. It can't be combined with `--list`, and it ignores `--reporter`. |
| `--port <port>` | With `--ui`, the port to serve on. Defaults to `9324`. When it's taken, a free port is used. |
| `--host <host>` | With `--ui`, the host to serve on. Defaults to `localhost`. |
| `--no-open` | With `--ui`, doesn't open the browser. |

Exit codes: `0` when every test passed, was skipped, or was flaky; `1` when a test failed, a file failed to load, no tests matched, or the config is invalid; `130` when interrupted. UI mode runs until you close its page or press Ctrl+C, and then exits with `0`.

See [Running and selecting tests](../running-tests/selecting-tests.md).

## intelliwright init

```bash
npx intelliwright init [options]
```

Creates `intelliwright.config.ts`, `e2e/pages/home.page.ts`, `e2e/fixtures.ts` and `e2e/home.e2e.ts` (`.mjs` in JavaScript projects), adds entries to `.gitignore`, and installs the [agent skill](../agent-skill.md). Files that already exist are kept. It never writes an API key.

| Option | What it does |
| --- | --- |
| `--provider <name>` | The Jev provider: `typesafe`, `vercel`, `openrouter`, `cloudflare` or `auto`. Without it, `init` asks. |
| `-y`, `--yes` | Asks nothing and uses `auto`, which picks the first provider key found in the environment. |
| `--no-skill` | Doesn't install the skill into `.cursor/skills` and `.claude/skills`. |

When the input isn't a terminal, `init` asks nothing, as with `--yes`.

## intelliwright install

```bash
npx intelliwright install [browsers...] [options]
```

Downloads browsers for the version of Playwright that Intelliwright uses. With no browser named, it installs `chromium`. Name `chromium`, `firefox`, `webkit` or `chromium-headless-shell` to install those instead. Other options go to Playwright's installer, such as `--with-deps` to also install system libraries on Linux, or `--force` to reinstall.

## intelliwright show-report

```bash
npx intelliwright show-report [folder] [options]
```

Serves an HTML report over HTTP and opens it in your browser, until you press Ctrl+C. The folder defaults to `intelliwright-report`.

| Option | Default | What it does |
| --- | --- | --- |
| `--port <port>` | `9323` | The port to serve on. When it's taken, a free port is used. |
| `--host <host>` | `localhost` | The host to serve on. |
| `--no-open` | | Doesn't open the browser. |

## Environment variables

| Variable | Effect |
| --- | --- |
| `TYPESAFE_API_KEY`, `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Jev provider keys. See [Providers](../jev/providers.md). |
| `CI` | When set, the HTML report never opens by itself. |
| `NO_COLOR` | Turns off colors in the terminal. |
| `FORCE_COLOR` | Turns colors on, even when the output isn't a terminal. `0` or `false` turns them off. |
