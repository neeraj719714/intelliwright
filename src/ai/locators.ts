import type { Locator, Page } from "playwright-core";

/** A locator that can be stored in the cache, rebuilt, and printed as code. */
export type LocatorDescriptor =
  | { kind: "testId"; value: string }
  | { kind: "role"; role: string; name: string; within?: { role: string; name?: string }; nth?: number }
  | { kind: "label"; text: string }
  | { kind: "placeholder"; text: string }
  | { kind: "text"; text: string; nth?: number };

type AriaRole = Parameters<Page["getByRole"]>[0];

export function buildLocator(page: Page, descriptor: LocatorDescriptor): Locator {
  switch (descriptor.kind) {
    case "testId":
      return page.getByTestId(descriptor.value);
    case "role": {
      const root = descriptor.within
        ? page.getByRole(descriptor.within.role as AriaRole, descriptor.within.name ? { name: descriptor.within.name, exact: true } : {})
        : page;
      const locator = root.getByRole(descriptor.role as AriaRole, { name: descriptor.name, exact: true });
      return descriptor.nth === undefined ? locator : locator.nth(descriptor.nth);
    }
    case "label":
      return page.getByLabel(descriptor.text, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(descriptor.text, { exact: true });
    case "text": {
      const locator = page.getByText(descriptor.text, { exact: true });
      return descriptor.nth === undefined ? locator : locator.nth(descriptor.nth);
    }
  }
}

/** The descriptor as Playwright code, such as `page.getByRole('button', { name: 'Save', exact: true })`. */
export function locatorCode(descriptor: LocatorDescriptor): string {
  const nth = "nth" in descriptor && descriptor.nth !== undefined ? `.nth(${descriptor.nth})` : "";
  switch (descriptor.kind) {
    case "testId":
      return `page.getByTestId(${quote(descriptor.value)})`;
    case "role": {
      const within = descriptor.within
        ? `getByRole(${quote(descriptor.within.role)}${descriptor.within.name ? `, { name: ${quote(descriptor.within.name)}, exact: true }` : ""}).`
        : "";
      return `page.${within}getByRole(${quote(descriptor.role)}, { name: ${quote(descriptor.name)}, exact: true })${nth}`;
    }
    case "label":
      return `page.getByLabel(${quote(descriptor.text)}, { exact: true })`;
    case "placeholder":
      return `page.getByPlaceholder(${quote(descriptor.text)}, { exact: true })`;
    case "text":
      return `page.getByText(${quote(descriptor.text)}, { exact: true })${nth}`;
  }
}

function quote(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}
