import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { listen } from "../cli/show-report.js";
import { REPORT_CSS } from "../reporters/html/styles.js";
import { openInBrowser } from "../reporters/open.js";
import { contentTypeFor } from "../runner/test-info.js";
import { UiSession, type UiSessionOptions } from "./session.js";
import type { UiEvent } from "./state.js";

export interface UiOptions extends UiSessionOptions {
  port: number;
  host: string;
  open: boolean;
}

const MAX_BODY_BYTES = 1_000_000;

/** Runs UI mode until Ctrl+C and returns the exit code. */
export async function runUi(options: UiOptions): Promise<number> {
  process.setSourceMapsEnabled(true);
  const session = await UiSession.start(options);
  let ui: UiServer | undefined;
  try {
    const { server } = (ui = createUiServer(session, options.host));
    const port = await listen(server, options.port, options.host).catch(() => listen(server, 0, options.host));
    const url = `http://${options.host.includes(":") ? `[${options.host}]` : options.host}:${port}/`;
    process.stdout.write(`UI mode is running at ${url}\nPress Ctrl+C to stop.\n`);
    if (options.open) openInBrowser(url);
    await untilStopped();
  } finally {
    await session.close().finally(() => ui?.close());
  }
  return 0;
}

interface UiServer {
  server: Server;
  close(): void;
}

function createUiServer(session: UiSession, host: string): UiServer {
  const page = renderUiHtml();
  const outputDir = session.config.outputDir;
  const clients = new Set<ServerResponse>();

  const stream = (request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
    // Unnamed events with the type inside, since EventSource uses the name "error" for lost connections.
    const write = (event: UiEvent): void => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    write({ type: "tests", state: session.state });
    const unsubscribe = session.subscribe(write);
    clients.add(response);
    request.on("close", () => {
      unsubscribe();
      clients.delete(response);
    });
  };

  const artifact = (pathname: string, response: ServerResponse): void => {
    let file: string | undefined;
    try {
      file = path.resolve(outputDir, decodeURIComponent(pathname.slice("/artifacts/".length)));
    } catch {}
    if (!file || !file.startsWith(outputDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      send(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypeFor(file),
      "cache-control": "no-store",
      // A saved HTML page can't run scripts against this server.
      "content-security-policy": "sandbox",
      "x-content-type-options": "nosniff",
    });
    createReadStream(file).pipe(response);
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const port = (server.address() as AddressInfo).port;
    const hostHeader = request.headers.host ?? "";
    if (!allowedHost(hostHeader, host, port)) return send(response, 403, { error: `Unknown host "${hostHeader}".` });
    const url = new URL(request.url ?? "/", `http://${hostHeader}`);
    if (request.method === "POST" && request.headers.origin !== undefined && request.headers.origin !== `http://${hostHeader}`) {
      return send(response, 403, { error: "Requests from other sites are not allowed." });
    }

    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
      });
      response.end(page);
      return;
    }
    if (route === "GET /api/tests") return send(response, 200, session.state);
    if (route === "GET /api/events") return stream(request, response);
    if (route === "POST /api/run") {
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        return send(response, 415, { error: "Send the test ids as JSON." });
      }
      const body = (await readJson(request).catch(() => undefined)) as { testIds?: unknown } | undefined;
      const ids = body?.testIds;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        return send(response, 400, { error: 'Send { "testIds": ["..."] }.' });
      }
      const result = session.run(ids);
      if (result === "busy") return send(response, 409, { error: "A run is already in progress." });
      if (result === "unknown") return send(response, 400, { error: "None of those tests are listed." });
      return send(response, 202, { started: true });
    }
    if (route === "POST /api/stop") return send(response, 200, { stopped: session.stop() });
    if (request.method === "GET" && url.pathname.startsWith("/artifacts/")) return artifact(url.pathname, response);
    send(response, 404, { error: "Not found." });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (response.headersSent) response.destroy();
      else send(response, 500, { error: String((error as Error)?.message ?? error) });
    });
  });
  // The event stream stays open for as long as the page does.
  server.requestTimeout = 0;

  return {
    server,
    close() {
      for (const client of clients) client.end();
      server.closeAllConnections();
      server.close();
    },
  };
}

/** One HTML file with the styles and the UI app inlined. */
function renderUiHtml(): string {
  const app = readFileSync(new URL("./ui-app.iife.js", import.meta.url), "utf8");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Intelliwright UI</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div id="app"></div>
<script>${app.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

/** Requests must name this server, so a page on another site can't reach it through DNS rebinding. */
function allowedHost(header: string, host: string, port: number): boolean {
  if (host === "0.0.0.0" || host === "::") return true;
  const named = (name: string): string => `${name.includes(":") ? `[${name}]` : name}:${port}`.toLowerCase();
  return [host, "localhost", "127.0.0.1", "::1"].map(named).includes(header.toLowerCase());
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("The request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Resolves on the first Ctrl+C or SIGTERM. A second one exits right away. */
function untilStopped(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
