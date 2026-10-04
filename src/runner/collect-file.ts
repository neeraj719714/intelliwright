import path from "node:path";
import { importModule } from "./loader.js";
import { toPosix } from "./location.js";
import { shared } from "./state.js";
import { createSuite, type SuiteNode, type TestNode } from "./tree.js";

export interface CollectedFile {
  file: string;
  /** Relative to the config folder, with forward slashes. */
  relFile: string;
  tests: TestNode[];
  byId: Map<string, TestNode>;
}

/** Imports one test file and returns its tests, without running them. */
export async function collectFile(file: string, rootDir: string): Promise<CollectedFile> {
  const state = shared();
  const root = createSuite("", undefined, undefined);
  state.collecting = { file, root, stack: [root] };
  try {
    await importModule(file);
  } finally {
    state.collecting = undefined;
  }
  return finalize(file, rootDir, root);
}

/** Gives each test its id, title path, inherited tags, and effective skip and only. */
function finalize(file: string, rootDir: string, root: SuiteNode): CollectedFile {
  const relFile = toPosix(path.relative(rootDir, file));
  const tests: TestNode[] = [];
  const seen = new Map<string, number>();

  const walk = (
    suite: SuiteNode,
    titles: string[],
    tags: string[],
    skipped: boolean,
    skipReason: string | undefined,
    only: boolean,
  ): void => {
    for (const child of suite.children) {
      const childSkipped = skipped || child.mode === "skip" || child.mode === "fixme";
      const childReason = skipped ? skipReason : child.skipReason;
      const childOnly = only || child.mode === "only";
      if (child.kind === "suite") {
        const childTitles = child.title ? [...titles, child.title] : titles;
        walk(child, childTitles, [...tags, ...child.tags], childSkipped, childReason, childOnly);
        continue;
      }
      child.titlePath = [...titles, child.title];
      child.tags = [...new Set([...tags, ...child.tags])];
      child.skipped = childSkipped;
      child.skipReason = childReason;
      child.only = childOnly;
      let id = `${relFile} › ${child.titlePath.join(" › ")}`;
      const count = (seen.get(id) ?? 0) + 1;
      seen.set(id, count);
      if (count > 1) id = `${id} (${count})`;
      child.id = id;
      tests.push(child);
    }
  };
  walk(root, [], root.tags, root.mode === "skip" || root.mode === "fixme", root.skipReason, false);
  return { file, relFile, tests, byId: new Map(tests.map((test) => [test.id, test])) };
}
