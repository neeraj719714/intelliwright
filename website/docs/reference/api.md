---
title: API
description: Everything the intelliwright package exports, with signatures.
---

## Entry points

| Import | Exports |
| --- | --- |
| `intelliwright` | `test`, `expect`, `defineConfig`, `BasePage`, `JevError`, `isJevError`, and types, including Playwright's `Page`, `Locator`, `BrowserContext` and others. |
| `intelliwright/ai-sdk` | `fromAiSdk`, which needs the `ai` package, version 7. |
| `intelliwright/testing` | `createMockEvaluator`. |

Playwright's types are re-exported, so you don't need to install `playwright-core` to import them:

```ts
import { type Locator, type Page } from "intelliwright";
```

## test

```ts
test(title: string, body: (fixtures, testInfo) => Promise<void> | void): void
test(title: string, details: { tag?: string | string[]; annotation?: Annotation | Annotation[] }, body): void
```

| Member | Signature | Notes |
| --- | --- | --- |
| `test.only` | Same as `test` | Runs only focused tests. |
| `test.skip` | Same as `test`, or `(condition?, description?)` | Declares a skipped test, or skips the current test or group. |
| `test.fixme` | Same as `test.skip` | Marked as something to fix. |
| `test.describe` | `(title, body)` or `(title, details, body)` | Groups tests. Also `test.describe.only` and `test.describe.skip`. |
| `test.beforeEach` | `(body: (fixtures, testInfo) => …)` | Runs before each test in scope. |
| `test.afterEach` | `(body: (fixtures, testInfo) => …)` | Runs after each test in scope, even after a failure or timeout. |
| `test.beforeAll` | `(body: ({ browser, browserName }, { workerIndex }) => …)` | Runs before the first test in scope. |
| `test.afterAll` | `(body: ({ browser, browserName }, { workerIndex }) => …)` | Runs after the last test in scope. |
| `test.step` | `(title: string, body: () => T \| Promise<T>) => Promise<T>` | Groups work under a title in reports. |
| `test.use` | `(options: UseOptions) => void` | Browser context options and `auth` for a file or `describe`. |
| `test.auth` | `(role: string, body) => void` | Signs in as `role`, in a setup file. |
| `test.extend` | `(fixtures) => TestFunction` | Returns a `test` with more fixtures. |
| `test.info` | `() => TestInfo` | The running test's info. |
| `test.setTimeout` | `(timeout: number) => void` | Changes the running test's timeout. |

Built-in fixtures: `page`, `context`, `browser`, `browserName`, `baseURL` and `ai`. See [Test basics](../writing-tests/basics.md), [Fixtures](../writing-tests/fixtures.md) and [Signing in](../writing-tests/signing-in.md).

### Fixture functions

```ts
type FixtureFunction<T, Deps> = (
  fixtures: Deps,
  provide: (value: T) => Promise<void>,
  testInfo: TestInfo,
) => Promise<void> | void;
```

`test.extend<Extra>(fixtures)` takes an object whose values are fixture functions or fixed values.

### TestInfo

| Member | Type |
| --- | --- |
| `title` | `string` |
| `titlePath` | `readonly string[]` |
| `file`, `line`, `column` | `string`, `number`, `number` |
| `tags` | `readonly string[]` |
| `retry` | `number` |
| `workerIndex` | `number` |
| `outputDir` | `string` |
| `annotations` | `Annotation[]` |
| `attachments` | `Attachment[]` |
| `signal` | `AbortSignal` |
| `timeout` | `number` |
| `status` | `"passed" \| "failed" \| "timedOut" \| "skipped" \| "interrupted" \| undefined` |
| `setTimeout(timeout)` | `void` |
| `skip(condition?, description?)` | `void` |
| `outputPath(...segments)` | `string` |
| `attach(name, { path?, body?, contentType? })` | `Promise<void>` |

## expect

`expect` is Jest's `expect`, with these matchers added. Page and AI matchers return promises; always `await` them.

| Matcher | Receives | Options |
| --- | --- | --- |
| `toBeVisible(options?)` | Locator | `timeout` |
| `toBeInViewport(options?)` | Locator | `timeout`, `ratio` |
| `toHaveText(expected, options?)` | Locator | `timeout`, `ignoreCase`, `useInnerText` |
| `toHaveCount(expected, options?)` | Locator | `timeout` |
| `toHaveURL(expected, options?)` | Page | `timeout` |
| `toHaveTitle(expected, options?)` | Page | `timeout` |
| `toSatisfy(claim, options?)` | Page or Locator | `timeout`, `minProbability` |
| `toSatisfyAll(claims, options?)` | Page or Locator | `timeout`, `minProbability` |
| `toScore(question, levels, options)` | Page or Locator | `timeout`, `atLeast`, `atMost` |

See [Assertions](../writing-tests/assertions.md) and [AI assertions](../jev/assertions.md).

## ai

The `ai` fixture, and `this.ai` in page objects:

```ts
interface Ai {
  evaluate<Qs extends Questions>(questions: Qs, options?: { scope?: Locator }): Promise<Answers<Qs>>;
  click(description: string, options?: ActionOptions): Promise<void>;
  fill(description: string, value: string, options?: ActionOptions): Promise<void>;
  select(description: string, value: string | string[], options?: ActionOptions): Promise<void>;
  check(description: string, options?: ActionOptions & { checked?: boolean }): Promise<void>;
  hover(description: string, options?: ActionOptions): Promise<void>;
  locate(description: string, options?: ActionOptions): Promise<Locator>;
  run(goal: string, options?: RunOptions): Promise<RunResult>;
}

interface ActionOptions {
  minProbability?: number;
  timeout?: number;
}

interface RunOptions {
  data?: Record<string, string>;
  maxSteps?: number;
  avoid?: string[];
  minProbability?: number;
}

interface RunResult {
  goal: string;
  goalMet: boolean;
  reason: "goal-met" | "stuck" | "max-steps" | "missing-data";
  steps: RunStep[];
  code: string;
  detail?: string;
  blockedNavigations: string[];
}

interface RunStep {
  index: number;
  action: "click" | "fill";
  element: string;
  code: string;
  dataKey?: string;
  probability: number;
  url: string;
}
```

See [AI actions](../jev/actions.md), [Goal-driven runs](../jev/goals.md) and [Asking Jev questions](../jev/questions.md).

## Questions and answers

```ts
interface BooleanQuestion {
  type: "boolean";
  instructions: Description;
  criteria?: { true?: Description; false?: Description };
}

interface ChoiceQuestion<Option extends string = string> {
  type: "choice";
  instructions: Description;
  criteria: Record<Option, Description>; // at most 255 options
}

interface ScoreQuestion {
  type: "score";
  instructions: Description;
  criteria: readonly Description[]; // 2 to 10 levels, lowest first
}

interface BooleanAnswer {
  type: "boolean";
  probability: number;
}

interface ChoiceAnswer<Option extends string = string> {
  type: "choice";
  choice: Option;
  probabilities: Record<Option, number>;
  confidence?: number;
}

interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: number[];
  confidence?: number;
}
```

`Description` is any JSON value: text, or a structure that describes the question, option or level.

## BasePage

```ts
abstract class BasePage {
  readonly page: Page;
  readonly ai: Ai;
  readonly path?: string;
  constructor(page: Page, ai: Ai);
  goto(options?: Parameters<Page["goto"]>[1]): Promise<void>;
  waitUntilReady(): Promise<void>;
}
```

See [Page objects](../writing-tests/page-objects.md).

## defineConfig

```ts
function defineConfig(config: IntelliwrightConfig): IntelliwrightConfig;
```

Returns the config unchanged and gives it types. See [Configuration](configuration.md).

## JevError

```ts
class JevError extends Error {
  readonly kind:
    | "config" | "auth" | "payment" | "forbidden" | "invalid_request"
    | "rate_limited" | "server" | "network" | "timeout" | "invalid_answer";
  readonly provider: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
}

function isJevError(error: unknown): error is JevError;
```

See [Errors](../jev/overview.md#errors).

## fromAiSdk

```ts
import { fromAiSdk } from "intelliwright/ai-sdk";

function fromAiSdk(
  model: string | EvaluationModel,
  options?: {
    name?: string;
    maxInputTokens?: number;
    maxRetries?: number;
    headers?: Record<string, string>;
    providerOptions?: ProviderOptions;
  },
): CustomProvider;
```

See [The AI SDK](../jev/providers.md#the-ai-sdk).

## createMockEvaluator

```ts
import { createMockEvaluator } from "intelliwright/testing";

function createMockEvaluator(
  handler: (request: { state: JsonValue; questions: Questions }) =>
    Record<string, MockAnswer> | Promise<Record<string, MockAnswer>>,
  options?: { name?: string; maxInputTokens?: number },
): MockEvaluator;

type MockAnswer = Answer | number | boolean | string;
```

The returned evaluator has `calls`, every request answered so far, and `reset()`. See [A mock for offline runs](../jev/providers.md#a-mock-for-offline-runs).
