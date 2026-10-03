import type { JsonValue } from "./types.js";

export const REDACTED = "[redacted]";

export interface RedactRules {
  /** Text matching any of these is masked. */
  patterns?: readonly RegExp[];
  /** These exact strings are masked, such as password field values. */
  values?: readonly string[];
}

export function redactText(text: string, rules: RedactRules): string {
  let result = text;
  const values = [...new Set(rules.values ?? [])]
    .filter((value) => value.trim().length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    result = result.split(value).join(REDACTED);
  }
  for (const pattern of rules.patterns ?? []) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    result = result.replace(new RegExp(pattern.source, flags), REDACTED);
  }
  return result;
}

/** Masks matching text in every string inside a JSON value. */
export function redactJson(value: JsonValue, rules: RedactRules): JsonValue {
  if (typeof value === "string") return redactText(value, rules);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, rules));
  if (value !== null && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) result[key] = redactJson(item, rules);
    return result;
  }
  return value;
}
