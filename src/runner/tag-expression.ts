/** A mistake in `--tag`, `--grep`, `--suite` or a file filter. */
export class SelectionError extends Error {
  override readonly name: string = "SelectionError";
}

type Node =
  | { kind: "tag"; tag: string }
  | { kind: "not"; operand: Node }
  | { kind: "and" | "or"; left: Node; right: Node };

interface Token {
  value: string;
  position: number;
}

/**
 * Compiles a tag expression such as `@smoke and not (@slow or @flaky)` into a
 * predicate over a test's tags. `not` binds tightest, then `and`, then `or`.
 * Tags compare case-insensitively.
 */
export function parseTagExpression(source: string): (tags: readonly string[]) => boolean {
  const tokens = tokenize(source);
  let index = 0;

  const fail = (message: string, token = tokens[index]): never => {
    const where = token ? ` at position ${token.position + 1}` : " at the end";
    throw new SelectionError(`Invalid tag expression "${source}": ${message}${where}.`);
  };
  const peek = (): string | undefined => tokens[index]?.value.toLowerCase();

  const parseOr = (): Node => {
    let node = parseAnd();
    while (peek() === "or") {
      index++;
      node = { kind: "or", left: node, right: parseAnd() };
    }
    return node;
  };
  const parseAnd = (): Node => {
    let node = parseNot();
    while (peek() === "and") {
      index++;
      node = { kind: "and", left: node, right: parseNot() };
    }
    return node;
  };
  const parseNot = (): Node => {
    if (peek() === "not") {
      index++;
      return { kind: "not", operand: parseNot() };
    }
    return parsePrimary();
  };
  const parsePrimary = (): Node => {
    const token = tokens[index];
    if (!token) return fail("expected a tag");
    if (token.value === "(") {
      index++;
      const node = parseOr();
      if (tokens[index]?.value !== ")") fail('expected ")"');
      index++;
      return node;
    }
    if (!token.value.startsWith("@") || token.value.length < 2) {
      return fail(`expected a tag such as @smoke but found "${token.value}"`, token);
    }
    index++;
    return { kind: "tag", tag: token.value.toLowerCase() };
  };

  if (tokens.length === 0) fail("it is empty");
  const tree = parseOr();
  if (index < tokens.length) fail(`unexpected "${tokens[index]?.value}"`);

  return (tags) => evaluate(tree, new Set(tags.map((tag) => tag.toLowerCase())));
}

function evaluate(node: Node, tags: Set<string>): boolean {
  switch (node.kind) {
    case "tag":
      return tags.has(node.tag);
    case "not":
      return !evaluate(node.operand, tags);
    case "and":
      return evaluate(node.left, tags) && evaluate(node.right, tags);
    case "or":
      return evaluate(node.left, tags) || evaluate(node.right, tags);
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*([()]|[^\s()]+)/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const value = match[1] ?? "";
    tokens.push({ value, position: match.index + match[0].length - value.length });
  }
  return tokens;
}
