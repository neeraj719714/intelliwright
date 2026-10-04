import { render } from "preact";
import type { ReportData } from "../data.js";
import { App } from "./app.js";

const data = JSON.parse(document.getElementById("report-data")?.textContent ?? "{}") as ReportData;
const root = document.getElementById("app");
if (root) render(<App data={data} />, root);
