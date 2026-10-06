---
title: What is Intelliwright?
sidebar_label: Introduction
description: Intelliwright is an end-to-end testing framework for web apps, with page objects and Jev-powered checks, actions and failure triage.
---

Intelliwright is an end-to-end testing framework for web apps. Tests run in real browsers through Playwright, and you write them with page objects: classes that hold the locators and actions for one page. On top of that, Jev, TypeSafe AI's decision model, lets a test check the page in plain English, act on an element by describing it, work towards a goal, and explain why it failed.

```ts title="e2e/notes.e2e.ts"
import { expect, test } from "./fixtures";

test("a user can save a note", async ({ page, newNotePage }) => {
  await newNotePage.goto();
  await newNotePage.save("Groceries");

  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page).toSatisfy("the new note is shown with its title");
});
```

## What you get

- **A test runner and command line.** `intelliwright test` runs test files in parallel worker processes, can retry failing tests, and selects tests by file, line, tag, title or named suite. With `--ui`, you run tests from the browser and watch the results arrive. See [Running and selecting tests](running-tests/selecting-tests.md).
- **An API you may already know.** `test`, `expect`, `test.describe`, hooks and fixtures work like Playwright Test. The `page` fixture is a Playwright `Page`, so every Playwright locator and action works.
- **Page objects.** `BasePage` and `test.extend()` make page objects the normal way to write tests, and `intelliwright init` scaffolds them. See [Page objects](writing-tests/page-objects.md).
- **Jev-powered features**, all optional:
  - [AI assertions](jev/assertions.md) such as `expect(page).toSatisfy("…")`.
  - [AI actions](jev/actions.md) such as `ai.click("the Sign in button")`, cached as readable locators.
  - [Goal-driven runs](jev/goals.md) with `ai.run("…")`, which hand back the flow as fixed Playwright code.
  - [Failure triage](jev/triage.md), which labels each failure as a regression, a test bug, flaky, or the environment.
- **Sign in once per run** with `test.auth()`, and start tests already signed in. See [Signing in](writing-tests/signing-in.md).
- **Reports**: a terminal summary, a self-contained HTML report with screenshots, traces and every AI decision, and JSON and JUnit files for CI. See [Reports and artifacts](running-tests/reports.md).
- **A skill for AI coding agents**, installed for Cursor and Claude Code, so agents write tests the same way you do. See [AI coding agents](agent-skill.md).

## How Jev fits in

Jev answers typed questions about a state: is this true, which of these options, or how good is this on a scale. Every answer is a probability. Intelliwright sends it the page as text: the URL, the title, and Playwright's ARIA snapshot, an outline of the page's roles, names and text. It never sends screenshots, and password fields are always masked.

Jev doesn't write code or text. It chooses among options Intelliwright gives it, such as the elements on the page, and any text a test types comes from the test. Each decision has a threshold, 0.7 by default, and the report lists every question with its answer and probability. Read more in [How Jev features work](jev/overview.md).

Tests that don't use Jev features run without an API key.

## Requirements

- Node.js 22 or newer.
- A web app reachable over HTTP: a local dev server, a staging site, or a deployed URL. Any stack works.
- For Jev features, a key from one Jev provider: TypeSafe, Vercel AI Gateway, OpenRouter or Cloudflare Workers AI.

Next, [install Intelliwright](getting-started/installation.mdx).
