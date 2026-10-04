// Serves a fixture site: node serve.mjs <dir> <port>
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const [dir = ".", port = "4173"] = process.argv.slice(2);
const root = path.resolve(dir);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const delay = Number(url.searchParams.get("delay") ?? 0);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file) && existsSync(path.join(root, "index.html")) && !path.extname(file)) {
    file = path.join(root, "index.html");
  }
  setTimeout(() => {
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }, delay);
}).listen(Number(port), "127.0.0.1", () => {
  process.stdout.write(`Serving ${root} on http://127.0.0.1:${port}\n`);
});
