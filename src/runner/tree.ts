import type { UseOptions } from "../config/types.js";
import type { FixtureLayer } from "./fixtures.js";
import type { Annotation, Location } from "./types.js";

export type Mode = "default" | "only" | "skip" | "fixme";

export type HookKind = "beforeEach" | "afterEach" | "beforeAll" | "afterAll";

export interface HookEntry {
  kind: HookKind;
  fn: (...args: any[]) => unknown;
  deps: string[];
  layers: readonly FixtureLayer[];
  location: Location;
}

export interface SuiteNode {
  kind: "suite";
  title: string;
  location: Location | undefined;
  tags: string[];
  mode: Mode;
  skipReason: string | undefined;
  children: Array<SuiteNode | TestNode>;
  hooks: Record<HookKind, HookEntry[]>;
  use: UseOptions[];
  parent: SuiteNode | undefined;
}

export interface TestNode {
  kind: "test";
  /** Stable across processes: the file path and title path. */
  id: string;
  title: string;
  titlePath: string[];
  location: Location;
  /** Own tags until the file is collected, then inherited tags too. */
  tags: string[];
  mode: Mode;
  skipReason: string | undefined;
  annotations: Annotation[];
  body: (...args: any[]) => unknown;
  deps: string[];
  layers: readonly FixtureLayer[];
  parent: SuiteNode;
  /** Effective after collection: true when the test or a describe above it is skipped. */
  skipped: boolean;
  /** Effective after collection: true when the test or a describe above it uses `.only`. */
  only: boolean;
}

export function createSuite(title: string, location: Location | undefined, parent: SuiteNode | undefined): SuiteNode {
  return {
    kind: "suite",
    title,
    location,
    tags: [],
    mode: "default",
    skipReason: undefined,
    children: [],
    hooks: { beforeEach: [], afterEach: [], beforeAll: [], afterAll: [] },
    use: [],
    parent,
  };
}

/** Outermost first, starting with the file's root suite. */
export function ancestors(node: TestNode | SuiteNode): SuiteNode[] {
  const chain: SuiteNode[] = [];
  for (let suite = node.parent; suite; suite = suite.parent) chain.unshift(suite);
  return chain;
}
