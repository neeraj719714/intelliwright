export const REPORT_CSS: string = `
:root {
  --bg: #f7f7f8; --panel: #ffffff; --text: #1d1d1f; --muted: #6b6b73; --line: #e3e3e8;
  --passed: #1a7f37; --failed: #cf222e; --flaky: #9a6700; --skipped: #6b6b73; --accent: #0969da;
  --code: #f2f2f5;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111114; --panel: #1b1b20; --text: #ececf1; --muted: #9b9ba6; --line: #2d2d35;
    --passed: #3fb950; --failed: #f85149; --flaky: #d29922; --skipped: #8b8b96; --accent: #58a6ff;
    --code: #24242b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, select, input { font: inherit; color: inherit; }
header { padding: 16px 24px; background: var(--panel); border-bottom: 1px solid var(--line); }
header h1 { margin: 0 0 4px; font-size: 18px; }
.meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 16px; }
.status-passed { color: var(--passed); } .status-failed { color: var(--failed); }
.status-flaky { color: var(--flaky); } .status-skipped, .status-notRun { color: var(--skipped); }
.status-queued, .status-running { color: var(--accent); }
.icon.status-running { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .3; } }
.filters { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 12px 24px; border-bottom: 1px solid var(--line); background: var(--panel); }
.segmented { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.segmented button { border: 0; background: transparent; padding: 4px 10px; cursor: pointer; border-right: 1px solid var(--line); }
.segmented button:last-child { border-right: 0; }
.segmented button[aria-pressed="true"] { background: var(--accent); color: #fff; }
.filters label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); }
.filters select, .filters input { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.layout { display: grid; grid-template-columns: minmax(280px, 2fr) 3fr; min-height: calc(100vh - 140px); }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
.list { border-right: 1px solid var(--line); overflow: auto; }
.file { display: flex; align-items: center; justify-content: space-between; padding: 8px 24px 4px; color: var(--muted); font-weight: 600; font-size: 12px; }
.row { display: flex; align-items: center; }
.row:hover, .row:has(> .test-row[aria-pressed="true"]) { background: var(--code); }
.test-row { display: flex; gap: 8px; align-items: baseline; width: 100%; min-width: 0; text-align: left; padding: 6px 24px; border: 0; background: transparent; cursor: pointer; }
.test-row:hover { background: var(--code); }
.test-row[aria-pressed="true"] { background: var(--code); box-shadow: inset 3px 0 var(--accent); }
.test-row .title { flex: 1; }
button.run { border: 0; background: transparent; color: var(--accent); cursor: pointer; padding: 4px 8px; font-size: 11px; line-height: 1; }
.row button.run { margin-right: 16px; }
.file button.run { margin-right: -8px; }
.actions { display: inline-flex; gap: 8px; }
.actions button { border: 1px solid var(--accent); background: var(--accent); color: #fff; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
.actions button.stop { background: transparent; color: var(--failed); border-color: var(--failed); }
.actions button:disabled, button.run:disabled { opacity: .45; cursor: default; }
.icon { width: 1em; display: inline-block; text-align: center; font-weight: 700; }
.tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 10px; border: 1px solid var(--line); color: var(--muted); margin-left: 4px; }
.chip { display: inline-block; font-size: 12px; padding: 0 8px; border-radius: 10px; background: var(--code); }
.duration { color: var(--muted); font-size: 12px; white-space: nowrap; }
.details { padding: 16px 24px; overflow: auto; }
.details h2 { margin: 0 0 4px; font-size: 16px; }
.empty { padding: 16px 24px; color: var(--muted); }
.tabs { display: flex; gap: 4px; margin: 12px 0; }
.tabs button { border: 1px solid var(--line); background: var(--panel); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.tabs button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.error pre { border-left: 3px solid var(--failed); }
.steps { list-style: none; margin: 0; padding: 0; }
.steps li { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--line); }
.steps li .step-title { flex: 1; }
.steps .category { font-size: 11px; color: var(--muted); min-width: 52px; }
.steps li.failed .step-title { color: var(--failed); }
.decisions { width: 100%; border-collapse: collapse; font-size: 13px; }
.decisions th, .decisions td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
section.block { margin-top: 16px; }
section.block h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
img.screenshot { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; }
details summary { cursor: pointer; }
a { color: var(--accent); }
`;
