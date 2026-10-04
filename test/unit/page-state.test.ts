import { describe, expect, test } from "vitest";
import { fitToBudget, renderYaml } from "../../src/ai/page-state.js";

const box = (y: number) => ({ x: 0, y, width: 100, height: 20 });

const tree = [
  {
    role: "banner",
    box: box(0),
    children: [{ role: "link", name: "Home", url: "/", box: box(0) }],
  },
  {
    role: "main",
    box: box(40),
    children: [
      { role: "heading", name: "Welcome", level: 1, box: box(40) },
      "Plain text",
      { role: "checkbox", name: "Remember me", checked: true, box: box(80) },
      { role: "textbox", name: "Email", text: "a@b.c", box: box(100) },
      {
        role: "list",
        box: box(120),
        children: [{ role: "listitem", box: box(120), children: [{ role: "link", name: "Deep", box: box(120) }] }],
      },
      { role: "button", name: "Far below", box: box(5_000) },
    ],
  },
];

describe("renderYaml", () => {
  test("renders nodes in Playwright's ARIA snapshot shape", () => {
    expect(renderYaml(tree)).toBe(
      [
        "- banner:",
        '  - link "Home":',
        "    - /url: /",
        "- main:",
        '  - heading "Welcome" [level=1]',
        "  - text: Plain text",
        '  - checkbox "Remember me" [checked]',
        '  - textbox "Email": a@b.c',
        "  - list:",
        "    - listitem:",
        '      - link "Deep"',
        '  - button "Far below"',
      ].join("\n"),
    );
  });

  test("replaces levels below the limit with a note", () => {
    expect(renderYaml(tree, 2)).toContain("    - note: 1 nested element left out");
  });
});

describe("fitToBudget", () => {
  test("drops off-screen nodes first", () => {
    const yaml = fitToBudget(tree, { width: 800, height: 600 }, () => true);
    expect(yaml).not.toContain("Far below");
    expect(yaml).toContain("- note: 1 off-screen element left out");
    expect(yaml).toContain('link "Deep"');
  });

  test("then drops deeply nested nodes", () => {
    const yaml = fitToBudget(tree, { width: 800, height: 600 }, (candidate) => !candidate.includes("Deep"));
    expect(yaml).not.toContain('link "Deep"');
    expect(yaml).toContain('heading "Welcome"');
  });
});
