import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright-core";
import { redactText, type RedactRules } from "./redact.js";
import { estimateStateTokens, REQUEST_OVERHEAD_TOKENS, usableBudget } from "./tokens.js";
import type { TokenBudget } from "./types.js";

/** What Jev sees of a page: compact JSON with the ARIA snapshot as YAML text. */
export interface PageState {
  [key: string]: string | boolean;
  url: string;
  title: string;
  aria: string;
}

export interface CaptureOptions {
  budget: TokenBudget;
  /** Regexes masked in the state; strings are selectors whose text is masked. */
  redact?: ReadonlyArray<RegExp | string>;
  /** Tokens to leave free for the questions. Defaults to 1,500. */
  questionTokens?: number;
  timeout?: number;
}

export interface CapturedState {
  state: PageState;
  /** Changes whenever what Jev would see changes. */
  hash: string;
  trimmed: boolean;
}

interface AriaNode {
  role?: string;
  name?: string;
  text?: string;
  url?: string;
  placeholder?: string;
  level?: number;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  box?: { x: number; y: number; width: number; height: number };
  children?: Array<AriaNode | string>;
}

const OMITTED_NOTE = "Parts of the page that are off-screen or deeply nested were left out to fit the request.";

/**
 * Captures the page, or one element, as `{ url, title, aria }`, trimmed to
 * the provider's token budget: off-screen nodes go first, then deeply nested
 * ones. Password values, matches of `redact` patterns, and the text of
 * `redact` selectors are masked before anything leaves the machine.
 */
export async function capturePageState(target: Page | Locator, options: CaptureOptions): Promise<CapturedState> {
  const isPage = typeof (target as Page).goto === "function";
  const page = isPage ? (target as Page) : (target as Locator).page();
  const timeout = options.timeout ?? 5_000;

  const [title, aria, rules] = await Promise.all([
    page.title().catch(() => ""),
    target.ariaSnapshot({ timeout }),
    redactRules(page, options.redact ?? []),
  ]);
  const limit = stateLimit(options);
  const base = { url: page.url(), title };

  let text = aria;
  let trimmed = false;
  if (estimateStateTokens({ ...base, aria: text }) > limit) {
    const tree = (await target.ariaSnapshotJSON({ boxes: true, timeout })) as Array<AriaNode | string>;
    const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
    text = fitToBudget(tree, viewport, (candidate) => estimateStateTokens({ ...base, aria: candidate, note: OMITTED_NOTE }) <= limit);
    trimmed = true;
  }

  const state: PageState = {
    url: redactText(base.url, rules),
    title: redactText(base.title, rules),
    aria: redactText(text, rules),
  };
  if (!isPage) state.element = String(target);
  if (trimmed) state.note = OMITTED_NOTE;
  return { state, hash: createHash("sha1").update(JSON.stringify(state)).digest("hex"), trimmed };
}

function stateLimit(options: CaptureOptions): number {
  const limits = usableBudget(options.budget);
  const questions = options.questionTokens ?? 1_500;
  return Math.min(limits.stateAndQuestion, limits.request - REQUEST_OVERHEAD_TOKENS) - questions;
}

async function redactRules(page: Page, redact: ReadonlyArray<RegExp | string>): Promise<RedactRules> {
  const patterns = redact.filter((item): item is RegExp => item instanceof RegExp);
  const selectors = redact.filter((item): item is string => typeof item === "string");
  const values: string[] = await page
    .locator('input[type="password"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
    .catch(() => []);
  for (const selector of selectors) {
    const texts = await page
      .locator(selector)
      .evaluateAll((elements) =>
        elements.flatMap((element) => [
          (element as HTMLInputElement).value ?? "",
          (element as HTMLElement).innerText ?? element.textContent ?? "",
        ]),
      )
      .catch(() => []);
    values.push(...texts.map((text) => text.trim()).filter(Boolean));
  }
  return { patterns, values };
}

/** Drops off-screen nodes, then deeper and deeper levels, until `fits` accepts the YAML. */
export function fitToBudget(
  tree: Array<AriaNode | string>,
  viewport: { width: number; height: number },
  fits: (yaml: string) => boolean,
): string {
  const visible = pruneOffscreen(tree, viewport);
  let yaml = renderYaml(visible);
  if (fits(yaml)) return yaml;

  for (let depth = maxDepth(visible) - 1; depth >= 1; depth--) {
    yaml = renderYaml(visible, depth);
    if (fits(yaml)) return yaml;
  }
  const lines = yaml.split("\n");
  while (lines.length > 1 && !fits(lines.join("\n"))) lines.splice(Math.floor(lines.length * 0.9));
  return `${lines.join("\n")}\n- note: the rest of the page was left out`;
}

/** Keeps nodes within one viewport of the visible area, and their ancestors. */
function pruneOffscreen(nodes: Array<AriaNode | string>, viewport: { width: number; height: number }): Array<AriaNode | string> {
  const top = -viewport.height;
  const bottom = viewport.height * 2;
  const near = (node: AriaNode): boolean => {
    if (!node.box || (node.box.width === 0 && node.box.height === 0)) return true;
    return node.box.y + node.box.height >= top && node.box.y <= bottom;
  };
  const walk = (list: Array<AriaNode | string>): Array<AriaNode | string> => {
    const kept: Array<AriaNode | string> = [];
    let dropped = 0;
    for (const node of list) {
      if (typeof node === "string") {
        kept.push(node);
        continue;
      }
      const children = node.children ? walk(node.children) : undefined;
      const hasChildren = Boolean(children?.some((child) => typeof child !== "string"));
      if (near(node) || hasChildren) kept.push({ ...node, children });
      else dropped++;
    }
    if (dropped > 0) kept.push({ role: "note", text: `${dropped} off-screen element${dropped === 1 ? "" : "s"} left out` });
    return kept;
  };
  return walk(nodes);
}

function maxDepth(nodes: Array<AriaNode | string>, depth = 1): number {
  let deepest = depth;
  for (const node of nodes) {
    if (typeof node !== "string" && node.children?.length) deepest = Math.max(deepest, maxDepth(node.children, depth + 1));
  }
  return deepest;
}

/** Renders nodes in the shape of Playwright's ARIA snapshot YAML. */
export function renderYaml(nodes: Array<AriaNode | string>, maxLevel: number = Infinity, level: number = 1): string {
  const pad = "  ".repeat(level - 1);
  const lines: string[] = [];
  for (const node of nodes) {
    if (typeof node === "string") {
      lines.push(`${pad}- text: ${oneLine(node)}`);
      continue;
    }
    let head = `${pad}- ${node.role ?? "generic"}`;
    if (node.name) head += ` ${JSON.stringify(node.name)}`;
    if (node.level !== undefined) head += ` [level=${node.level}]`;
    if (node.checked !== undefined) head += node.checked === "mixed" ? " [checked=mixed]" : node.checked ? " [checked]" : "";
    if (node.pressed !== undefined) head += node.pressed === "mixed" ? " [pressed=mixed]" : node.pressed ? " [pressed]" : "";
    if (node.disabled) head += " [disabled]";
    if (node.expanded !== undefined) head += node.expanded ? " [expanded]" : "";
    if (node.selected) head += " [selected]";

    const extras: string[] = [];
    if (node.url) extras.push(`${pad}  - /url: ${node.url}`);
    if (node.placeholder) extras.push(`${pad}  - /placeholder: ${node.placeholder}`);
    const children = node.children ?? [];
    if (level >= maxLevel && children.length > 0) {
      lines.push(`${head}:`, ...extras, `${pad}  - note: ${children.length} nested element${children.length === 1 ? "" : "s"} left out`);
      continue;
    }
    const nested = children.length ? renderYaml(children, maxLevel, level + 1) : "";
    if (node.text !== undefined && !nested && extras.length === 0) {
      lines.push(`${head}: ${oneLine(node.text)}`);
    } else if (nested || extras.length) {
      lines.push(`${head}:`);
      if (node.text !== undefined) lines.push(`${pad}  - text: ${oneLine(node.text)}`);
      lines.push(...extras);
      if (nested) lines.push(nested);
    } else {
      lines.push(head);
    }
  }
  return lines.join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
