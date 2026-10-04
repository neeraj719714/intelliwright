import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openInBrowser, shouldOpenReport } from "../open.js";
import type { Reporter, RunInfo, RunSummary } from "../types.js";
import { buildReportData, type ReportData } from "./data.js";
import { REPORT_CSS } from "./styles.js";

export interface HtmlReporterOptions {
  /** Relative to the config folder. Defaults to `intelliwright-report`. */
  outputFolder?: string;
  /** Defaults to the config's `report.open`. */
  open?: "on-failure" | "always" | "never";
}

/** Writes a self-contained `index.html`, with screenshots and traces in `data/` next to it. */
export class HtmlReporter implements Reporter {
  readonly #options: HtmlReporterOptions;
  #folder = "";
  #rootDir = "";
  #open: "on-failure" | "always" | "never" = "on-failure";

  constructor(options: HtmlReporterOptions = {}) {
    this.#options = options;
  }

  onBegin(run: RunInfo): void {
    this.#rootDir = run.config.rootDir;
    this.#folder = path.resolve(run.config.rootDir, this.#options.outputFolder ?? "intelliwright-report");
    this.#open = this.#options.open ?? run.config.reportOpen;
  }

  onEnd(summary: RunSummary): void {
    const insideProject = this.#folder.startsWith(this.#rootDir + path.sep);
    if (insideProject) rmSync(this.#folder, { recursive: true, force: true });
    mkdirSync(this.#folder, { recursive: true });
    const data = buildReportData(summary, this.#folder, this.#rootDir);
    const index = path.join(this.#folder, "index.html");
    writeFileSync(index, renderReportHtml(data));

    const shown = path.relative(process.cwd(), index) || index;
    process.stdout.write(`  HTML report: ${shown}. Open it with: npx intelliwright show-report\n\n`);
    if (shouldOpenReport(this.#open, summary.status)) openInBrowser(pathToFileURL(index).href);
  }
}

/** One HTML file with the styles, the report app and its data inlined. */
export function renderReportHtml(data: ReportData): string {
  const app = readFileSync(new URL("./report-app.iife.js", import.meta.url), "utf8");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Intelliwright report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="report-data">${json}</script>
<script>${app.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}
