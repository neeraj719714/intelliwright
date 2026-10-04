import { writeFileSync } from "node:fs";

export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env.GLOBAL_SETUP_RAN = "yes";
  return async () => {
    if (process.env.TEARDOWN_MARKER) writeFileSync(process.env.TEARDOWN_MARKER, "torn down");
  };
}
