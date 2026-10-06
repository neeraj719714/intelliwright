import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { openInBrowser } from "../reporters/open.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".zip": "application/zip",
  ".yml": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface ShowReportOptions {
  port: number;
  host: string;
  open: boolean;
}

/** Serves a report folder over HTTP and opens it, until Ctrl+C. */
export async function showReport(folder: string, options: ShowReportOptions): Promise<number> {
  const root = path.resolve(folder);
  if (!existsSync(path.join(root, "index.html"))) {
    process.stderr.write(`No report found in ${root}. Run intelliwright test first.\n`);
    return 1;
  }

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });

  const port = await listen(server, options.port, options.host).catch(() => listen(server, 0, options.host));
  const url = `http://${options.host}:${port}/`;
  process.stdout.write(`Serving the report at ${url}\nPress Ctrl+C to stop.\n`);
  if (options.open) openInBrowser(url);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  server.closeAllConnections();
  server.close();
  return 0;
}

export function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
