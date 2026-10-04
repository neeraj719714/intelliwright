import { appendFileSync } from "node:fs";
import type { TestInfo } from "intelliwright";

/** Records which worker ran a test, so the runner's tests can count workers. */
export function logWorker(testInfo: TestInfo): void {
  if (process.env.WORKER_LOG) appendFileSync(process.env.WORKER_LOG, `${testInfo.workerIndex}\n`);
}
