import { render, type JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { App, type RunControls } from "../../reporters/html/app/app.js";
import { applyEvent, type UiEvent, type UiState } from "../state.js";

function Ui(): JSX.Element {
  const [state, setState] = useState<UiState | undefined>(undefined);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    // EventSource reconnects by itself, and the server starts each connection with the whole state.
    const source = new EventSource("/api/events");
    source.onmessage = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as UiEvent;
      setState((current) => (event.type === "tests" ? event.state : current && applyEvent(current, event)));
    };
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  const controls = useMemo<RunControls>(
    () => ({
      connected,
      run: (testIds) => void post("/api/run", { testIds }),
      stop: () => void post("/api/stop", {}),
    }),
    [connected],
  );
  return state ? <App data={state} controls={controls} /> : <p class="empty">Connecting to intelliwright test --ui…</p>;
}

function post(url: string, body: unknown): Promise<unknown> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

const root = document.getElementById("app");
if (root) render(<Ui />, root);
