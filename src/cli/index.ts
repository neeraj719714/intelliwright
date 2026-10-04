#!/usr/bin/env node
import { fileURLToPath } from "node:url";

if (process.argv[2] === "__worker") {
  const { runWorkerProcess } = await import("../runner/worker.js");
  runWorkerProcess();
} else {
  const { createProgram, reportCliError } = await import("./program.js");
  try {
    await createProgram(fileURLToPath(import.meta.url)).parseAsync(process.argv);
  } catch (error) {
    process.exitCode = reportCliError(error);
  }
}
