import { fork, type ChildProcess } from "node:child_process";
import type { ConfigOverrides } from "../config/types.js";
import type { Job, MainMessage, WorkerMessage } from "./protocol.js";
import type { SerializedError } from "./types.js";

export interface PoolOptions {
  workers: number;
  /** The CLI entry, forked with `__worker`. */
  entry: string;
  cwd: string;
  configFile: string | undefined;
  overrides: ConfigOverrides;
  onMessage(workerIndex: number, message: WorkerMessage): void;
  /** A worker died while running `job`, or before it could start. */
  onCrash(workerIndex: number, job: Job | undefined, reason: string): void;
  /** The worker couldn't start, so the remaining jobs are abandoned. */
  onFatal(error: SerializedError, abandoned: Job[]): void;
}

/** Hands one file's tests at a time to each forked worker until none are left. */
export class WorkerPool {
  readonly #options: PoolOptions;
  readonly #children = new Set<ChildProcess>();
  #queue: Job[] = [];
  #nextWorkerIndex = 0;
  #fatal = false;
  #stopped = false;

  constructor(options: PoolOptions) {
    this.#options = options;
  }

  async run(jobs: Job[]): Promise<void> {
    if (this.#stopped) return;
    this.#queue = [...jobs];
    const slots = Math.min(this.#options.workers, jobs.length);
    await Promise.all(Array.from({ length: slots }, () => this.#runSlot()));
  }

  /** Puts tests back at the front of the queue, such as the rest of a crashed worker's file. */
  requeue(job: Job): void {
    if (!this.#stopped) this.#queue.unshift(job);
  }

  /** Kills every worker, for example on Ctrl+C. The pool runs nothing after that. */
  stop(): void {
    this.#stopped = true;
    this.#queue = [];
    for (const child of this.#children) child.kill("SIGKILL");
  }

  async #runSlot(): Promise<void> {
    while (this.#queue.length > 0 && !this.#fatal) {
      const crashed = await this.#runWorker(this.#nextWorkerIndex++);
      if (!crashed) return;
    }
  }

  #runWorker(workerIndex: number): Promise<boolean> {
    const options = this.#options;
    return new Promise((resolve) => {
      const child = fork(options.entry, ["__worker"], {
        cwd: options.cwd,
        env: { ...process.env, INTELLIWRIGHT_WORKER_INDEX: String(workerIndex) },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      this.#children.add(child);
      let current: Job | undefined;
      let stopping = false;

      const send = (message: MainMessage): void => {
        if (child.connected) child.send(message);
      };
      const next = (): void => {
        current = this.#fatal ? undefined : this.#queue.shift();
        if (current) {
          send({ type: "run", ...current });
        } else {
          stopping = true;
          send({ type: "stop" });
        }
      };

      child.on("message", (message: WorkerMessage) => {
        if (message.type === "ready") {
          next();
        } else if (message.type === "done") {
          options.onMessage(workerIndex, message);
          next();
        } else if (message.type === "fatal") {
          if (current) {
            options.onCrash(workerIndex, current, message.error.message);
            current = undefined;
          } else {
            this.#fatal = true;
            options.onFatal(message.error, this.#queue.splice(0));
          }
        } else {
          options.onMessage(workerIndex, message);
        }
      });

      child.on("exit", (code, signal) => {
        this.#children.delete(child);
        if (stopping && code === 0) return resolve(false);
        if (current) {
          options.onCrash(workerIndex, current, `Worker process exited unexpectedly (${signal ?? `code ${code}`}).`);
        }
        resolve(!this.#fatal);
      });

      send({
        type: "init",
        init: { workerIndex, cwd: options.cwd, configFile: options.configFile, overrides: options.overrides },
      });
    });
  }
}
