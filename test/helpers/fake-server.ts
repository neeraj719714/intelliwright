import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  delayMs?: number;
}

export type FakeHandler = (request: RecordedRequest, index: number) => FakeResponse | Promise<FakeResponse>;

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  maxInFlight: number;
  close(): Promise<void>;
}

/** A local HTTP server that records every request and answers with `handler`. */
export async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0 };

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, inFlight);
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {}
      const recorded: RecordedRequest = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body };
      const index = requests.push(recorded) - 1;
      try {
        const response = await handler(recorded, index);
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        const payload = response.json !== undefined ? JSON.stringify(response.json) : (response.text ?? "");
        res.writeHead(response.status ?? 200, {
          "content-type": response.json !== undefined ? "application/json" : "text/plain",
          ...response.headers,
        });
        res.end(payload);
      } catch (error) {
        res.writeHead(500);
        res.end(String(error));
      } finally {
        inFlight--;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get maxInFlight() {
      return state.maxInFlight;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A fetch that sends every request to `server`, remembering the URL it was meant for. */
export function redirectTo(server: FakeServer, seen: string[]): typeof fetch {
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    seen.push(url.href);
    return fetch(`${server.url}${url.pathname}${url.search}`, init);
  };
}
