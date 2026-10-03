// Loaded with `node --import`: prints every module URL the process resolved.
import { registerHooks } from "node:module";

const resolved = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    resolved.add(result.url);
    return result;
  },
});

process.on("exit", () => {
  process.stdout.write(`\n__RESOLVED__${JSON.stringify([...resolved])}\n`);
});
