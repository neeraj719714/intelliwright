import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { formatCost, formatDuration } from "../../format.js";
import type { ReportAttempt, ReportData, ReportTest } from "../data.js";

type StatusFilter = "all" | ReportTest["outcome"];

interface Filters {
  status: StatusFilter;
  tag: string;
  file: string;
  query: string;
  test: string;
}

const STATUSES: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "flaky", label: "Flaky" },
  { value: "skipped", label: "Skipped" },
];

const ICONS: Record<ReportTest["outcome"], string> = { passed: "✓", failed: "✘", flaky: "↻", skipped: "–", notRun: "·" };

function readHash(): Filters {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    status: (params.get("status") as StatusFilter | null) ?? "all",
    tag: params.get("tag") ?? "",
    file: params.get("file") ?? "",
    query: params.get("q") ?? "",
    test: params.get("test") ?? "",
  };
}

function writeHash(filters: Filters): void {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.file) params.set("file", filters.file);
  if (filters.query) params.set("q", filters.query);
  if (filters.test) params.set("test", filters.test);
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}

export function App({ data }: { data: ReportData }): JSX.Element {
  const [filters, setFilters] = useState<Filters>(readHash);
  const update = (change: Partial<Filters>): void => {
    const next = { ...filters, ...change };
    writeHash(next);
    setFilters(next);
  };

  useEffect(() => {
    const onHashChange = (): void => setFilters(readHash());
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  const tags = useMemo(() => [...new Set(data.tests.flatMap((test) => test.tags))].sort(), [data]);
  const files = useMemo(() => [...new Set(data.tests.map((test) => test.file))].sort(), [data]);
  const query = filters.query.trim().toLowerCase();
  const visible = data.tests.filter(
    (test) =>
      (filters.status === "all" || test.outcome === filters.status) &&
      (!filters.tag || test.tags.includes(filters.tag)) &&
      (!filters.file || test.file === filters.file) &&
      (!query || test.titlePath.join(" ").toLowerCase().includes(query)),
  );
  const selected = data.tests.find((test) => test.id === filters.test);

  const groups = new Map<string, ReportTest[]>();
  for (const test of visible) groups.set(test.file, [...(groups.get(test.file) ?? []), test]);

  return (
    <div>
      <Header data={data} />
      <div class="filters">
        <div class="segmented" role="group" aria-label="Status">
          {STATUSES.map(({ value, label }) => (
            <button type="button" aria-pressed={filters.status === value} onClick={() => update({ status: value })}>
              {label}
              {value !== "all" ? ` (${data.counts[value as keyof ReportData["counts"]] ?? 0})` : ` (${data.tests.length})`}
            </button>
          ))}
        </div>
        <label>
          Tag
          <select aria-label="Tag" value={filters.tag} onChange={(event) => update({ tag: event.currentTarget.value })}>
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option value={tag}>{tag}</option>
            ))}
          </select>
        </label>
        <label>
          File
          <select aria-label="File" value={filters.file} onChange={(event) => update({ file: event.currentTarget.value })}>
            <option value="">All files</option>
            {files.map((file) => (
              <option value={file}>{file}</option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label="Search titles"
          placeholder="Search titles"
          value={filters.query}
          onInput={(event) => update({ query: event.currentTarget.value })}
        />
      </div>
      <div class="layout">
        <section class="list" aria-label="Tests">
          {visible.length === 0 && <p class="empty">No tests match these filters.</p>}
          {[...groups.entries()].map(([file, tests]) => (
            <div>
              <div class="file">{file}</div>
              {tests.map((test) => (
                <button
                  type="button"
                  class="test-row"
                  data-testid="test-row"
                  data-outcome={test.outcome}
                  aria-pressed={test.id === filters.test}
                  onClick={() => update({ test: test.id })}
                >
                  <span class={`icon status-${test.outcome}`} aria-label={test.outcome}>
                    {ICONS[test.outcome]}
                  </span>
                  <span class="title">
                    {test.titlePath.join(" › ")}
                    {test.tags.map((tag) => (
                      <span class="tag">{tag}</span>
                    ))}
                    {test.triage && <span class="tag">{test.triage.label}</span>}
                  </span>
                  <span class="duration">{formatDuration(test.duration)}</span>
                </button>
              ))}
            </div>
          ))}
        </section>
        <section class="details" aria-label="Test details">
          {selected ? <TestDetails test={selected} /> : <p class="empty">Select a test to see its steps, errors and attachments.</p>}
        </section>
      </div>
    </div>
  );
}

function Header({ data }: { data: ReportData }): JSX.Element {
  const { counts } = data;
  const parts = [
    counts.passed && `${counts.passed} passed`,
    counts.failed && `${counts.failed} failed`,
    counts.flaky && `${counts.flaky} flaky`,
    counts.skipped && `${counts.skipped} skipped`,
  ].filter(Boolean);
  return (
    <header>
      <h1>
        Intelliwright report <span class={`status-${data.status === "passed" ? "passed" : "failed"}`}>· {data.status}</span>
      </h1>
      <div class="meta">
        <span data-testid="totals">
          {data.tests.length} tests: {parts.join(", ")}
        </span>
        <span>{formatDuration(data.duration)}</span>
        <span>{new Date(data.startTime).toLocaleString()}</span>
        {data.ai && (
          <span>
            Jev via {data.ai.provider}
            {data.ai.usage.models.length ? ` (${data.ai.usage.models.join(", ")})` : ""}: {data.ai.usage.calls} calls,{" "}
            {data.ai.usage.inputTokens.toLocaleString("en-US")} input tokens, {formatCost(data.ai.usage.costUsd)}
            {data.ai.usage.costEstimated ? " (estimated)" : ""}
          </span>
        )}
      </div>
      {data.errors.map((error) => (
        <div class="error">
          <pre>{error.message}</pre>
        </div>
      ))}
      {data.notes.map((note) => (
        <p class="meta status-flaky">{note}</p>
      ))}
    </header>
  );
}

function TestDetails({ test }: { test: ReportTest }): JSX.Element {
  const [index, setIndex] = useState(test.attempts.length - 1);
  useEffect(() => setIndex(test.attempts.length - 1), [test.id]);
  const attempt = test.attempts[Math.min(index, test.attempts.length - 1)];
  return (
    <div>
      <h2>{test.titlePath.join(" › ")}</h2>
      <div class="meta">
        <span class={`status-${test.outcome}`}>{test.outcome}</span>
        <span>
          {test.file}:{test.line}
        </span>
        {test.tags.map((tag) => (
          <span class="tag">{tag}</span>
        ))}
      </div>
      {test.triage && (
        <section class="block" aria-label="Triage">
          <h3>Triage</h3>
          <span class="chip">{test.triage.label}</span>
          {test.triage.probability !== undefined && <span> {Math.round(test.triage.probability * 100)}%</span>}
          {test.triage.severity !== undefined && <span> · severity {test.triage.severity.toFixed(1)} of 3</span>}
          {test.triage.note && <div class="meta">{test.triage.note}</div>}
        </section>
      )}
      {test.attempts.length > 1 && (
        <div class="tabs" role="group" aria-label="Attempts">
          {test.attempts.map((item, i) => (
            <button type="button" aria-pressed={i === index} onClick={() => setIndex(i)}>
              {item.retry === 0 ? "First attempt" : `Retry ${item.retry}`} · {item.status}
            </button>
          ))}
        </div>
      )}
      {attempt && <Attempt attempt={attempt} />}
    </div>
  );
}

function Attempt({ attempt }: { attempt: ReportAttempt }): JSX.Element {
  const images = attempt.attachments.filter((attachment) => attachment.contentType.startsWith("image/") && attachment.path);
  const texts = attempt.attachments.filter((attachment) => attachment.body !== undefined);
  const files = attempt.attachments.filter(
    (attachment) => attachment.path && !attachment.contentType.startsWith("image/") && attachment.body === undefined,
  );
  return (
    <div>
      <div class="meta">
        <span class={`status-${attempt.status === "passed" ? "passed" : attempt.status === "skipped" ? "skipped" : "failed"}`}>
          {attempt.status}
        </span>
        <span>{formatDuration(attempt.duration)}</span>
      </div>
      {attempt.errors.length > 0 && (
        <section class="block error" aria-label="Errors">
          <h3>Errors</h3>
          {attempt.errors.map((error) => (
            <pre>
              {error.message}
              {error.location ? `\n\nat ${error.location.file}:${error.location.line}:${error.location.column}` : ""}
            </pre>
          ))}
        </section>
      )}
      {attempt.steps.length > 0 && (
        <section class="block" aria-label="Steps">
          <h3>Steps</h3>
          <ol class="steps">
            {attempt.steps.map((step) => (
              <li class={step.error ? "failed" : ""} style={{ paddingLeft: `${step.depth * 16}px` }}>
                <span class="category">{step.category}</span>
                <span class="step-title">{step.title}</span>
                <span class="duration">{formatDuration(step.duration)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {attempt.ai && attempt.ai.decisions.length > 0 && (
        <section class="block" aria-label="AI decisions">
          <h3>AI decisions</h3>
          <table class="decisions">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Probability</th>
              </tr>
            </thead>
            <tbody>
              {attempt.ai.decisions.map((decision) => (
                <tr class={decision.passed === false ? "status-failed" : ""}>
                  <td>{decision.kind}</td>
                  <td>{decision.question}</td>
                  <td>
                    {decision.answer}
                    {decision.passed !== undefined ? (decision.passed ? " ✓" : " ✘") : ""}
                  </td>
                  <td>
                    {decision.probability !== undefined ? decision.probability.toFixed(2) : "–"}
                    {decision.confidence !== undefined ? ` (confidence ${decision.confidence.toFixed(2)})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="meta">
            {attempt.ai.provider}: {attempt.ai.usage.calls} calls, {attempt.ai.usage.inputTokens.toLocaleString("en-US")} input tokens,{" "}
            {formatCost(attempt.ai.usage.costUsd)}
          </div>
        </section>
      )}
      {images.length > 0 && (
        <section class="block" aria-label="Screenshots">
          <h3>Screenshots</h3>
          {images.map((image) => (
            <img class="screenshot" src={image.path} alt={image.name} />
          ))}
        </section>
      )}
      {files.length > 0 && (
        <section class="block" aria-label="Files">
          <h3>Files</h3>
          <ul>
            {files.map((file) => (
              <li>
                <a href={file.path} download>
                  {file.name}
                </a>
                {file.name === "trace" && (
                  <span class="meta"> · open it with npx playwright-core show-trace, or at trace.playwright.dev</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {texts.map((text) => (
        <section class="block" aria-label={text.name}>
          <details>
            <summary>{text.name}</summary>
            <pre>{text.body || "(empty)"}</pre>
          </details>
        </section>
      ))}
    </div>
  );
}
