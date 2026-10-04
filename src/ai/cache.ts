import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LocatorDescriptor } from "./locators.js";

export interface CacheEntry {
  locator: LocatorDescriptor;
  /** The element as Jev saw it when it was chosen. */
  element: string;
  updated: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

/**
 * Resolved locators in `.intelliwright/cache.json`, keyed by URL path, action
 * and description. Workers merge their changes into the file under a lock.
 */
export class LocatorCache {
  readonly file: string;
  #entries: Record<string, CacheEntry>;
  readonly #changed = new Map<string, CacheEntry>();

  constructor(rootDir: string) {
    this.file = path.join(rootDir, ".intelliwright", "cache.json");
    this.#entries = readEntries(this.file);
  }

  static key(url: string, action: string, description: string): string {
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {}
    return `${pathname} ${action} ${description}`;
  }

  get(key: string): CacheEntry | undefined {
    return this.#entries[key];
  }

  set(key: string, entry: CacheEntry): void {
    this.#entries[key] = entry;
    this.#changed.set(key, entry);
  }

  /** Writes this worker's changes, merged with whatever other workers wrote. */
  flush(): void {
    if (this.#changed.size === 0) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    withLock(`${this.file}.lock`, () => {
      const entries = { ...readEntries(this.file), ...Object.fromEntries(this.#changed) };
      const data: CacheFile = { version: 1, entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) };
      const temp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
      renameSync(temp, this.file);
      this.#entries = entries;
    });
    this.#changed.clear();
  }
}

function readEntries(file: string): Record<string, CacheEntry> {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheFile>;
    return parsed.version === 1 && parsed.entries ? parsed.entries : {};
  } catch {
    return {};
  }
}

function withLock(lock: string, body: () => void): void {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = statSync(lock, { throwIfNoEntry: false });
      if (!info) continue;
      if (Date.now() - info.mtimeMs > 10_000 || Date.now() > deadline) {
        rmSync(lock, { force: true });
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    body();
  } finally {
    rmSync(lock, { force: true });
  }
}
