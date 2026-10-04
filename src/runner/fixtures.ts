import type { TestInfo } from "./types.js";

export interface FixtureDefinition {
  name: string;
  fn?: (...args: any[]) => unknown;
  value?: unknown;
  deps: string[];
}

export type FixtureLayer = Readonly<Record<string, FixtureDefinition>>;

/** Turns the object passed to `test.extend()` into a layer of definitions. */
export function toLayer(fixtures: Record<string, unknown>): FixtureLayer {
  const layer: Record<string, FixtureDefinition> = {};
  for (const [name, definition] of Object.entries(fixtures)) {
    if (typeof definition === "function") {
      const fn = definition as (...args: any[]) => unknown;
      layer[name] = { name, fn, deps: parameterNames(fn, `Fixture "${name}"`) };
    } else {
      layer[name] = { name, value: definition, deps: [] };
    }
  }
  return layer;
}

/**
 * Reads the names destructured in a function's first parameter, as in
 * `async ({ page, ai }, provide) => ...`. That is how fixtures and tests say
 * which fixtures they need.
 */
export function parameterNames(fn: (...args: any[]) => unknown, what: string): string[] {
  const params = parameterList(stripComments(fn.toString()));
  const first = splitTopLevel(params)[0]?.trim() ?? "";
  if (!first || first.startsWith("_")) return [];
  if (!first.startsWith("{") || !first.endsWith("}")) {
    throw new Error(`${what} must destructure the fixtures it uses, as in async ({ page }) => { ... }. Got "${first}".`);
  }
  return splitTopLevel(first.slice(1, -1))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith("...")) {
        throw new Error(`${what} can't use a rest element (${entry}) when destructuring fixtures.`);
      }
      return entry.split(/[:=]/)[0]!.trim();
    });
}

function parameterList(source: string): string {
  const arrow = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source);
  if (arrow) return arrow[1] ?? "";
  const open = source.indexOf("(");
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    } else if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i);
    }
  }
  return source.slice(open + 1);
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") depth--;
    else if (char === '"' || char === "'" || char === "`") i = skipString(text, i);
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function skipString(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

interface Instance {
  name: string;
  value: unknown;
  teardown: () => Promise<void>;
}

/**
 * Sets up the fixtures one test asks for, each at most once, in dependency
 * order, and tears them down in reverse. A fixture that overrides one of the
 * same name gets the overridden one as its dependency.
 */
export class FixtureScope {
  readonly #builtins: FixtureLayer;
  readonly #layers: readonly FixtureLayer[];
  readonly #testInfo: TestInfo;
  readonly #instances = new Map<string, Promise<Instance>>();
  readonly #order: Instance[] = [];

  constructor(builtins: FixtureLayer, layers: readonly FixtureLayer[], testInfo: TestInfo) {
    this.#builtins = builtins;
    this.#layers = layers;
    this.#testInfo = testInfo;
  }

  async values(names: readonly string[]): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    for (const name of names) values[name] = await this.#get(name, this.#layers.length, []);
    return values;
  }

  /** Tears down in reverse setup order and returns every teardown error. */
  async teardown(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const instance of this.#order.reverse()) {
      try {
        await instance.teardown();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#order.length = 0;
    return errors;
  }

  #lookup(name: string, below: number): { definition: FixtureDefinition; level: number } | undefined {
    for (let level = below - 1; level >= 0; level--) {
      const definition = this.#layers[level]?.[name];
      if (definition && Object.hasOwn(this.#layers[level]!, name)) return { definition, level };
    }
    if (Object.hasOwn(this.#builtins, name)) return { definition: this.#builtins[name]!, level: -1 };
    return undefined;
  }

  async #get(name: string, below: number, chain: string[]): Promise<unknown> {
    const found = this.#lookup(name, below);
    if (!found) {
      const neededBy = chain.at(-1)?.split(":")[1];
      throw new Error(`Unknown fixture "${name}"${neededBy ? `, needed by "${neededBy}"` : ""}. Add it with test.extend().`);
    }
    const key = `${found.level}:${name}`;
    if (chain.includes(key)) {
      throw new Error(`Fixtures depend on each other in a loop: ${[...chain, key].map((k) => k.split(":")[1]).join(" -> ")}.`);
    }
    let pending = this.#instances.get(key);
    if (!pending) {
      pending = this.#create(found.definition, found.level, [...chain, key]);
      this.#instances.set(key, pending);
    }
    return (await pending).value;
  }

  async #create(definition: FixtureDefinition, level: number, chain: string[]): Promise<Instance> {
    const deps: Record<string, unknown> = {};
    for (const dep of definition.deps) {
      deps[dep] = await this.#get(dep, dep === definition.name ? level : this.#layers.length, chain);
    }
    if (!definition.fn) {
      const instance = { name: definition.name, value: definition.value, teardown: async () => {} };
      this.#order.push(instance);
      return instance;
    }

    const fn = definition.fn;
    let provided = false;
    let resolveValue!: (value: unknown) => void;
    let rejectValue!: (error: unknown) => void;
    const valuePromise = new Promise<unknown>((resolve, reject) => {
      resolveValue = resolve;
      rejectValue = reject;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));

    const finished = (async () =>
      fn(
        deps,
        async (value: unknown) => {
          if (provided) throw new Error(`Fixture "${definition.name}" called provide() twice.`);
          provided = true;
          resolveValue(value);
          await released;
        },
        this.#testInfo,
      ))();
    finished.then(
      () => {
        if (!provided) rejectValue(new Error(`Fixture "${definition.name}" finished without calling provide(value).`));
      },
      (error: unknown) => {
        if (!provided) rejectValue(error);
      },
    );

    const value = await valuePromise;
    const instance: Instance = {
      name: definition.name,
      value,
      teardown: async () => {
        release();
        await finished;
      },
    };
    this.#order.push(instance);
    return instance;
  }
}
