---
title: AI coding agents
description: The Intelliwright skill teaches Cursor, Claude Code and other agents to write, fix and review tests the same way you do.
---

Intelliwright ships a skill for AI coding agents: a set of instructions that agents such as Cursor and Claude Code apply when they write, fix or review Intelliwright tests. It keeps tests written by an agent consistent with the rest of the suite.

## Installing it

`npx intelliwright init` copies the skill into your project:

```text
.cursor/skills/intelliwright/
.claude/skills/intelliwright/
```

Commit both folders, so every teammate's agent uses them. Skip the skill with `npx intelliwright init --no-skill`.

After upgrading Intelliwright, get the matching version of the skill by running `npx intelliwright init --yes` again. It replaces the skill files and keeps every file that already exists. It does create any of its starter files that are missing, so if you deleted the example home page test, it comes back. To avoid that, copy the skill from the installed package instead:

```bash
cp -R node_modules/intelliwright/skills/intelliwright .cursor/skills/
cp -R node_modules/intelliwright/skills/intelliwright .claude/skills/
```

## What's in it

| File | What it covers |
| --- | --- |
| `SKILL.md` | Where files go, a complete example, page object rules, locator priority, waiting, test data, signing in, Jev-powered checks and actions, tags, what to do when a test fails, and a review checklist. |
| `page-objects.md` | Naming, and templates for pages, components and fixtures. |
| `flakiness.md` | Common causes of flaky tests and how to fix each one, plus a checklist. |

The agent reads `SKILL.md` when the task involves `*.e2e.ts` tests, page objects in `e2e/pages`, `e2e/fixtures.ts` or the Intelliwright config, and opens the other two files when it needs them. The guidance matches these docs: [page objects](writing-tests/page-objects.md), [assertions](writing-tests/assertions.md), [signing in](writing-tests/signing-in.md), [AI assertions](jev/assertions.md) and [fixing flaky tests](running-tests/flaky-tests.md).

## Asking an agent for tests

Agents work best with a concrete flow and the page objects they should use or extend:

```text
Add an end-to-end test that a signed-in member can rename a note.
Use NoteListPage and add a rename(title, newTitle) method to it.
Tag it @notes and @smoke, and clean up the note in afterEach.
```

When a test fails, point the agent at the failure: the error, the triage label, and the report's steps and trace. The skill tells it to treat a `regression` as an app bug rather than changing the test to pass.
