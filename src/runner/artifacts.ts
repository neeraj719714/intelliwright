import { writeFileSync } from "node:fs";
import type { BrowserContext, Request } from "playwright-core";
import type { TestInfoImpl } from "./test-info.js";

const MAX_ENTRIES = 1_000;
const CAPTURE_TIMEOUT_MS = 5_000;

export interface NetworkEntry {
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  failure?: string;
  startTime: number;
  durationMs?: number;
}

/** Collects console messages, page errors and network requests for every page in a context. */
export class ArtifactRecorder {
  readonly console: string[] = [];
  readonly network: NetworkEntry[] = [];
  readonly #pending = new Map<Request, NetworkEntry>();

  constructor(context: BrowserContext) {
    context.on("console", (message) => {
      const { url, lineNumber } = message.location();
      const where = url ? ` (${url}${lineNumber ? `:${lineNumber}` : ""})` : "";
      this.#log(`[${message.type()}] ${message.text()}${where}`);
    });
    context.on("weberror", (webError) => {
      const error = webError.error();
      this.#log(`[pageerror] ${error.stack ?? error.message}`);
    });
    context.on("request", (request) => {
      if (this.network.length >= MAX_ENTRIES) return;
      const entry: NetworkEntry = {
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        startTime: Date.now(),
      };
      this.network.push(entry);
      this.#pending.set(request, entry);
    });
    context.on("requestfinished", (request) => {
      const entry = this.#pending.get(request);
      if (!entry) return;
      this.#pending.delete(request);
      entry.durationMs = Date.now() - entry.startTime;
      request.response().then(
        (response) => {
          entry.status = response?.status();
        },
        () => {},
      );
    });
    context.on("requestfailed", (request) => {
      const entry = this.#pending.get(request);
      if (!entry) return;
      this.#pending.delete(request);
      entry.durationMs = Date.now() - entry.startTime;
      entry.failure = request.failure()?.errorText ?? "failed";
    });
  }

  #log(line: string): void {
    if (this.console.length < MAX_ENTRIES) this.console.push(line);
  }
}

/**
 * After a failed attempt, saves a screenshot and ARIA snapshot of each open
 * page, the trace, and the console and network logs, and attaches them.
 * After a passing attempt, the trace is discarded.
 */
export async function finishArtifacts(context: BrowserContext, recorder: ArtifactRecorder, info: TestInfoImpl): Promise<void> {
  const failed = info.status === "failed" || info.status === "timedOut";
  if (!failed) {
    await context.tracing.stop().catch(() => {});
    return;
  }

  try {
    const file = info.outputPath("trace.zip");
    await context.tracing.stop({ path: file });
    info.attachments.push({ name: "trace", contentType: "application/zip", path: file });
  } catch {}

  const pages = context.pages();
  for (const [index, page] of pages.entries()) {
    const suffix = pages.length > 1 ? `-${index + 1}` : "";
    try {
      const file = info.outputPath(`screenshot${suffix}.png`);
      await page.screenshot({ path: file, fullPage: true, timeout: CAPTURE_TIMEOUT_MS });
      info.attachments.push({ name: `screenshot${suffix}`, contentType: "image/png", path: file });
    } catch {}
    try {
      const snapshot = await page.locator(":root").ariaSnapshot({ timeout: CAPTURE_TIMEOUT_MS });
      const file = info.outputPath(`aria-snapshot${suffix}.yml`);
      writeFileSync(file, `# ${page.url()}\n${snapshot}\n`);
      info.attachments.push({ name: `aria snapshot${suffix}`, contentType: "text/yaml", path: file });
    } catch {}
  }

  const consoleFile = info.outputPath("console.log");
  writeFileSync(consoleFile, recorder.console.length ? `${recorder.console.join("\n")}\n` : "");
  info.attachments.push({ name: "console", contentType: "text/plain", path: consoleFile });

  const networkFile = info.outputPath("network.json");
  writeFileSync(networkFile, `${JSON.stringify(recorder.network, null, 2)}\n`);
  info.attachments.push({ name: "network", contentType: "application/json", path: networkFile });
}
