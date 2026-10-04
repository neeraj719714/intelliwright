import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { repoRoot } from "./cli.js";

let browser: Browser | undefined;

export async function testBrowser(): Promise<Browser> {
  browser ??= await chromium.launch();
  return browser;
}

export async function closeTestBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
};

/** Opens a trace in Playwright's own trace viewer and returns the page text once it loads. */
export async function readTraceInViewer(traceFile: string): Promise<string> {
  const viewer = path.join(repoRoot, "node_modules", "playwright-core", "lib", "vite", "traceViewer");
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const file = pathname === "/trace.zip" ? traceFile : path.join(viewer, pathname === "/" ? "index.html" : pathname);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await (await testBrowser()).newPage();
  try {
    await page.goto(`${base}/index.html?trace=${encodeURIComponent(`${base}/trace.zip`)}`);
    await page.getByText("Navigate").first().waitFor({ timeout: 15_000 });
    return await page.locator("body").innerText();
  } finally {
    await page.close();
    server.close();
  }
}

/** Parses XML with the browser's DOMParser, a real XML parser. */
export async function parseXml(xml: string): Promise<{
  error: string | null;
  root: Record<string, string>;
  suites: Array<Record<string, string | number>>;
}> {
  const page = await (await testBrowser()).newPage();
  try {
    return await page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, "application/xml");
      const error = doc.querySelector("parsererror")?.textContent ?? null;
      const attributes = (element: Element): Record<string, string> =>
        Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value]));
      return {
        error,
        root: doc.documentElement ? attributes(doc.documentElement) : {},
        suites: [...doc.querySelectorAll("testsuite")].map((suite) => ({
          ...attributes(suite),
          cases: suite.querySelectorAll("testcase").length,
        })),
      };
    }, xml);
  } finally {
    await page.close();
  }
}
