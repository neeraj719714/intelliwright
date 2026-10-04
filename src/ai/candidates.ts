import type { Page } from "playwright-core";

export type ActionKind = "click" | "fill" | "select" | "check" | "hover" | "locate";

/** An element an action could target, as Jev sees it. */
export interface Candidate {
  /** Option key in the choice question, such as `e3`. */
  key: string;
  /** Playwright's element reference from the AI-mode ARIA snapshot. */
  ref: string;
  role: string;
  name: string;
  /** Text of an element without an accessible name. */
  text: string;
  /** Nearest landmark around it, such as `navigation "Main"`. */
  landmark: { role: string; name?: string } | undefined;
  placeholder: string | undefined;
  /** What Jev reads, such as `button "Sign in" in banner`. */
  description: string;
}

interface AiNode {
  role?: string;
  name?: string;
  text?: string;
  ref?: string;
  cursor?: string;
  placeholder?: string;
  disabled?: boolean;
  box?: { width: number; height: number };
  children?: Array<AiNode | string>;
}

/** The most options a choice question takes, leaving one for `none`. */
export const MAX_CANDIDATES = 254;

const LANDMARKS = new Set(["banner", "navigation", "main", "contentinfo", "complementary", "region", "form", "search", "dialog", "alertdialog"]);
const CLICKABLE = new Set([
  "button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "treeitem", "combobox", "textbox", "searchbox", "spinbutton", "slider",
]);
const FILLABLE = new Set(["textbox", "searchbox", "spinbutton", "combobox"]);
const SELECTABLE = new Set(["combobox", "listbox"]);
const CHECKABLE = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
const SKIP_FOR_LOCATE = new Set(["generic", "text", "none", "presentation", "document"]);

function fits(kind: ActionKind, node: AiNode): boolean {
  const role = node.role ?? "generic";
  const hasOptions = Boolean(node.children?.some((child) => typeof child !== "string" && child.role === "option"));
  switch (kind) {
    case "click":
    case "hover":
      return CLICKABLE.has(role) || node.cursor === "pointer";
    case "fill":
      return FILLABLE.has(role) && !(role === "combobox" && hasOptions);
    case "select":
      return SELECTABLE.has(role) && (role === "listbox" || hasOptions);
    case "check":
      return CHECKABLE.has(role);
    case "locate":
      return CLICKABLE.has(role) || node.cursor === "pointer" || (!SKIP_FOR_LOCATE.has(role) && Boolean(node.name || node.text));
  }
}

function textOf(node: AiNode): string {
  const parts: string[] = [];
  const walk = (current: AiNode | string): void => {
    if (typeof current === "string") parts.push(current);
    else {
      if (current.text) parts.push(current.text);
      else if (current.name) parts.push(current.name);
      current.children?.forEach(walk);
    }
  };
  walk(node);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Visible, enabled elements that suit the action, in document order. */
export async function findCandidates(page: Page, kind: ActionKind): Promise<Candidate[]> {
  const tree = (await page.ariaSnapshotJSON({ mode: "ai", boxes: true, timeout: 5_000 })) as Array<AiNode | string>;
  const candidates: Candidate[] = [];

  const walk = (nodes: Array<AiNode | string>, landmark: Candidate["landmark"]): void => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      const role = node.role ?? "generic";
      const visible = !node.box || (node.box.width > 0 && node.box.height > 0);
      if (node.ref && visible && !node.disabled && fits(kind, node)) {
        const name = node.name ?? "";
        const text = name ? "" : textOf(node);
        const label = name || text;
        const where = landmark ? ` in ${landmark.role}${landmark.name ? ` ${JSON.stringify(landmark.name)}` : ""}` : "";
        candidates.push({
          key: `e${candidates.length}`,
          ref: node.ref,
          role,
          name,
          text,
          landmark,
          placeholder: node.placeholder,
          description: `${role}${label ? ` ${JSON.stringify(label)}` : ""}${node.placeholder ? ` (placeholder ${JSON.stringify(node.placeholder)})` : ""}${where}`,
        });
      }
      const inner = LANDMARKS.has(role) ? { role, name: node.name } : landmark;
      if (node.children) walk(node.children, inner);
    }
  };
  walk(tree, undefined);
  return candidates;
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "with", "that", "this", "at", "by", "is"]);

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !STOP_WORDS.has(word)));
}

/** Most shared words with the description first, then document order; capped for the choice question. */
export function rankCandidates(candidates: Candidate[], description: string, cap: number = MAX_CANDIDATES): Candidate[] {
  const wanted = words(description);
  return candidates
    .map((candidate, index) => {
      let shared = 0;
      for (const word of words(candidate.description)) if (wanted.has(word)) shared++;
      return { candidate, index, shared };
    })
    .sort((a, b) => b.shared - a.shared || a.index - b.index)
    .slice(0, cap)
    .map(({ candidate }, index) => ({ ...candidate, key: `e${index}` }));
}
