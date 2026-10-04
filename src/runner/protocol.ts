import type { ConfigOverrides } from "../config/types.js";
import type { AttemptResult, SerializedError, StepResult } from "./types.js";

export interface WorkerInit {
  workerIndex: number;
  cwd: string;
  configFile: string | undefined;
  overrides: ConfigOverrides;
}

export interface Job {
  file: string;
  testIds: string[];
}

export type MainMessage =
  | { type: "init"; init: WorkerInit }
  | ({ type: "run" } & Job)
  | { type: "stop" };

export type WorkerMessage =
  | { type: "ready" }
  | { type: "testBegin"; testId: string; retry: number; startTime: number }
  | { type: "stepEnd"; testId: string; retry: number; step: StepResult }
  | { type: "testEnd"; testId: string; result: AttemptResult; willRetry: boolean }
  | { type: "done"; errors: SerializedError[] }
  | { type: "fatal"; error: SerializedError };
