---
title: Reports and artifacts
description: The terminal summary, the HTML report, JSON and JUnit output, and the screenshot, trace and logs saved for each failure.
---

Every run reports to the terminal and writes an HTML report. JSON and JUnit reporters are there for CI.

```ts title="intelliwright.config.ts"
export default defineConfig({
  reporters: ["terminal", "html", ["junit", { outputFile: "reports/junit.xml" }]],
  report: { open: "never" },
});
```

`reporters` lists reporter names, or `[name, options]` pairs. `--reporter terminal,json` replaces the list for one run.

## Terminal

While tests run, each one gets a line as it finishes: `✓` passed, `✘` failed or timed out, `-` skipped (with the reason), and a note when a test is retried or passes on a retry. At the end:

- each failure, with its error, the lines of code around the failing line, its [triage label](../jev/triage.md) and its artifact folder;
- the counts of passed, failed, flaky and skipped tests, with the failed and flaky ones listed;
- the counts for each tag;
- the three slowest tests;
- a `Jev` line with the provider, the model versions that answered, the number of calls, the input tokens and the cost;
- notes, such as triage being skipped;
- the total time.

Colors are used only when the output is a terminal. `NO_COLOR` turns them off, and `FORCE_COLOR` turns them on.

## HTML report

The HTML reporter writes `intelliwright-report/index.html`: one self-contained file, with screenshots, traces and other files in `data/` next to it.

```bash
npx intelliwright show-report
```

serves the last report on `http://localhost:9323` and opens it. It takes a folder, `--port`, `--host` and `--no-open`; see the [command line reference](../reference/cli.md#intelliwright-show-report).

The report has:

- totals, the run's duration, and Jev usage for the run;
- filters by status, tag and file, and a search box;
- for each test: its tags, triage label, each attempt with its annotations, such as why it was skipped, errors with their locations, a timeline of steps, and an **AI decisions** table with every question, answer and probability;
- for failed attempts: the screenshot, the ARIA snapshot, the console and network logs, and the trace;
- attachments, such as the code from [`ai.run`](../jev/goals.md#turning-a-run-into-code) and anything a test attached with `testInfo.attach()`.

The selected filters and test are kept in the page's URL, so a link opens the same view.

[UI mode](selecting-tests.md#ui-mode) shows the same view while tests run, and fills it in as results arrive.

| Option | Default | What it does |
| --- | --- | --- |
| `outputFolder` | `intelliwright-report` | Where the report goes, relative to the config's folder. It's replaced on every run. |
| `open` | `report.open` | When to open the report: `on-failure`, `always` or `never`. |

`report.open` in the config defaults to `on-failure`: after a local run with failures, the report opens in your browser. It never opens when the `CI` environment variable is set.

## JSON

The JSON reporter writes the whole run, every attempt of every test included, to `test-results/results.json`. Set another path with `outputFile`. The file has the run's status, duration, counts and Jev usage, and for each test its file, line, title path, tags, outcome, triage, and attempts with their errors, steps, attachments and AI decisions.

## JUnit

The JUnit reporter writes `test-results/junit.xml` for CI systems that show test results. Set another path with `outputFile`.

- Each test file is a `testsuite`, and each test a `testcase` named by its title path.
- Flaky tests count as passed, the same as in the terminal summary.
- A failure's `system-out` holds its triage label and the paths of its artifacts.

## Artifacts

When an attempt fails or times out, Intelliwright saves the evidence to its own folder under `test-results/`, named after the file and test, with `-retry1` and so on for retries:

| File | What it holds |
| --- | --- |
| `trace.zip` | A Playwright trace: every action, with DOM snapshots, screenshots and sources. |
| `screenshot.png` | A full-page screenshot of each open page, numbered when there are several. |
| `aria-snapshot.yml` | The ARIA snapshot of each open page, with its URL. |
| `console.log` | Console messages and uncaught page errors. |
| `network.json` | Every request, with its method, URL, status, failure and timing. |

When an attempt passes, nothing is saved. Open a trace with Playwright's trace viewer:

```bash
npx playwright-core show-trace test-results/e2e-notes-e2e-saves-a-note-a1b2c3/trace.zip
```

or drop the file on [trace.playwright.dev](https://trace.playwright.dev).

Artifacts are captured after `afterEach` hooks and fixture teardown, so they show the page as cleanup left it. For [`ai.run`](../jev/goals.md#when-a-run-stops) failures, the report also has the page state Jev last answered from.

`test-results/` is cleared at the start of each run, except for `.last-run.json`, which [`--last-failed`](selecting-tests.md#rerunning-failures) reads. UI mode doesn't clear it between runs. Set another folder with `outputDir`.
