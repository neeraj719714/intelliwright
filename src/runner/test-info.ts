import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../config/types.js";
import type { ArtifactRecorder } from "./artifacts.js";
import { SkipSignal } from "./collect.js";
import type { TestNode } from "./tree.js";
import type { Annotation, Attachment, TestInfo, TestStatus } from "./types.js";

export class TestTimeoutError extends Error {
  override readonly name: string = "TestTimeoutError";
  constructor(timeout: number, message = `Test timeout of ${timeout}ms exceeded.`) {
    super(message);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".html": "text/html",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** A short, unique, filesystem-safe folder name for a test. */
export function testSlug(test: Pick<TestNode, "id" | "titlePath">, relFile: string): string {
  const readable = `${relFile.replace(/\.[^./]+$/, "")}-${test.titlePath.join("-")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const hash = createHash("sha1").update(test.id).digest("hex").slice(0, 6);
  return `${readable}-${hash}`;
}

export class TestInfoImpl implements TestInfo {
  readonly title: string;
  readonly titlePath: readonly string[];
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly tags: readonly string[];
  readonly retry: number;
  readonly workerIndex: number;
  readonly outputDir: string;
  readonly annotations: Annotation[];
  readonly attachments: Attachment[] = [];
  status: TestStatus | undefined = undefined;
  /** Console and network logs of the test's browser context, for artifacts and triage. */
  recorder: ArtifactRecorder | undefined = undefined;
  /** Called when `setTimeout` changes the deadline. */
  onTimeoutChange: (() => void) | undefined;
  readonly #controller = new AbortController();
  #timeout: number;

  constructor(test: TestNode, relFile: string, retry: number, workerIndex: number, config: ResolvedConfig) {
    this.title = test.title;
    this.titlePath = test.titlePath;
    this.file = test.location.file;
    this.line = test.location.line;
    this.column = test.location.column;
    this.tags = test.tags;
    this.retry = retry;
    this.workerIndex = workerIndex;
    this.annotations = [...test.annotations];
    this.#timeout = config.timeout;
    this.outputDir = path.join(config.outputDir, `${testSlug(test, relFile)}${retry ? `-retry${retry}` : ""}`);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get timeout(): number {
    return this.#timeout;
  }

  setTimeout(timeout: number): void {
    this.#timeout = timeout;
    this.onTimeoutChange?.();
  }

  skip(condition = true, description?: string): void {
    if (!condition) return;
    this.annotations.push({ type: "skip", description });
    throw new SkipSignal(description ?? "skipped");
  }

  outputPath(...segments: string[]): string {
    mkdirSync(this.outputDir, { recursive: true });
    return path.join(this.outputDir, ...segments);
  }

  async attach(
    name: string,
    options: { path?: string; body?: string | Uint8Array; contentType?: string },
  ): Promise<void> {
    if (options.path) {
      const target = this.outputPath(`${safeName(name)}${path.extname(options.path)}`);
      if (path.resolve(options.path) !== target) copyFileSync(options.path, target);
      this.attachments.push({ name, contentType: options.contentType ?? contentTypeFor(options.path), path: target });
      return;
    }
    if (typeof options.body === "string") {
      this.attachments.push({ name, contentType: options.contentType ?? "text/plain", body: options.body });
      return;
    }
    if (options.body) {
      const target = this.outputPath(safeName(name));
      writeFileSync(target, options.body);
      this.attachments.push({ name, contentType: options.contentType ?? "application/octet-stream", path: target });
      return;
    }
    throw new Error(`testInfo.attach("${name}") needs a path or a body.`);
  }

  abort(reason: unknown): void {
    this.#controller.abort(reason);
  }
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "-");
}
