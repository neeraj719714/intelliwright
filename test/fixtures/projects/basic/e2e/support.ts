import { appendFileSync } from "node:fs";
import type { Page, TestInfo } from "intelliwright";

/** Records which worker ran a test, so the runner's tests can count workers. */
export function logWorker(testInfo: TestInfo): void {
  if (process.env.WORKER_LOG) appendFileSync(process.env.WORKER_LOG, `${testInfo.workerIndex}\n`);
}

/** Records what an afterEach hook saw, so the runner's tests can check that cleanup ran. */
export async function logCleanup(page: Page, testInfo: TestInfo): Promise<void> {
  if (process.env.CLEANUP_LOG) appendFileSync(process.env.CLEANUP_LOG, `${testInfo.status} ${await page.title()}\n`);
}
