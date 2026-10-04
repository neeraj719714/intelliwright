import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import colors from "picocolors";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
type Provider = "typesafe" | "vercel" | "openrouter" | "cloudflare" | "auto";

export interface ProjectInfo {
  packageManager: PackageManager;
  typescript: boolean;
  framework: "next" | "nuxt" | "astro" | "vite" | undefined;
  /** The package.json script that starts the app, such as `dev`. */
  devScript: string | undefined;
}

export interface InitOptions {
  cwd: string;
  provider?: string;
  yes?: boolean;
  skill?: boolean;
}

const PROVIDERS: Record<Provider, { label: string; keys: string }> = {
  typesafe: { label: "TypeSafe", keys: "TYPESAFE_API_KEY" },
  vercel: { label: "Vercel AI Gateway", keys: "AI_GATEWAY_API_KEY" },
  openrouter: { label: "OpenRouter", keys: "OPENROUTER_API_KEY" },
  cloudflare: { label: "Cloudflare Workers AI", keys: "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID" },
  auto: { label: "Decide later: use the first key set in the environment", keys: "one provider's key" },
};

const GITIGNORE = [
  "test-results/",
  "intelliwright-report/",
  ".intelliwright/history.json",
  ".intelliwright/auth/",
  ".intelliwright/recorder-profile/",
];

export function detectProject(root: string, env: Record<string, string | undefined> = process.env): ProjectInfo {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string): boolean => Object.hasOwn(deps, name);

  const lockfiles: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  const agent = env.npm_config_user_agent ?? "";
  const packageManager =
    lockfiles.find(([file]) => existsSync(path.join(root, file)))?.[1] ??
    (["pnpm", "yarn", "bun"] as const).find((name) => agent.startsWith(`${name}/`)) ??
    "npm";

  return {
    packageManager,
    typescript: existsSync(path.join(root, "tsconfig.json")) || has("typescript"),
    framework: has("next") ? "next" : has("nuxt") ? "nuxt" : has("astro") ? "astro" : has("vite") ? "vite" : undefined,
    devScript: pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : undefined,
  };
}

export function commands(packageManager: PackageManager): { add: string; exec: string; run: (script: string) => string } {
  switch (packageManager) {
    case "pnpm":
      return { add: "pnpm add -D intelliwright", exec: "pnpm exec intelliwright", run: (script) => `pnpm ${script}` };
    case "yarn":
      return { add: "yarn add -D intelliwright", exec: "yarn intelliwright", run: (script) => `yarn ${script}` };
    case "bun":
      return { add: "bun add -d intelliwright", exec: "bunx intelliwright", run: (script) => `bun run ${script}` };
    default:
      return { add: "npm install --save-dev intelliwright", exec: "npx intelliwright", run: (script) => `npm run ${script}` };
  }
}

function defaultPort(framework: ProjectInfo["framework"]): number {
  return framework === "vite" ? 5173 : framework === "astro" ? 4321 : 3000;
}

async function askProvider(): Promise<Provider> {
  const choices = Object.entries(PROVIDERS) as Array<[Provider, { label: string }]>;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("Which Jev provider do you use?\n");
    choices.forEach(([, { label }], index) => process.stdout.write(`  ${index + 1}. ${label}\n`));
    const answer = (await readline.question(`Choose 1-${choices.length} [1]: `)).trim();
    const index = answer ? Number(answer) - 1 : 0;
    return choices[index]?.[0] ?? "typesafe";
  } finally {
    readline.close();
  }
}

/** Creates the config, the `e2e/` scaffold and the `.gitignore` entries. Never writes a key. */
export async function init(options: InitOptions): Promise<number> {
  const root = path.resolve(options.cwd);
  const project = detectProject(root);
  const cmd = commands(project.packageManager);

  let provider: Provider;
  if (options.provider) {
    if (!Object.hasOwn(PROVIDERS, options.provider)) {
      process.stderr.write(`Unknown provider "${options.provider}". Use typesafe, vercel, openrouter, cloudflare or auto.\n`);
      return 1;
    }
    provider = options.provider as Provider;
  } else if (options.yes || !process.stdin.isTTY) {
    provider = "auto";
  } else {
    provider = await askProvider();
  }

  const ext = project.typescript ? "ts" : "mjs";
  const port = defaultPort(project.framework);
  const files: Array<[string, string]> = [
    [`intelliwright.config.${ext}`, configTemplate(project, provider, port, cmd)],
    [`e2e/pages/home.page.${ext}`, project.typescript ? HOME_PAGE_TS : HOME_PAGE_JS],
    [`e2e/fixtures.${ext}`, project.typescript ? FIXTURES_TS : FIXTURES_JS],
    [`e2e/home.e2e.${ext}`, HOME_TEST.replace("./fixtures", project.typescript ? "./fixtures" : "./fixtures.mjs")],
  ];

  const created: string[] = [];
  const kept: string[] = [];
  for (const [file, contents] of files) {
    const target = path.join(root, file);
    if (existsSync(target)) {
      kept.push(file);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    created.push(file);
  }
  const gitignoreChanged = updateGitignore(root);

  const out = (text = ""): void => {
    process.stdout.write(`${text}\n`);
  };
  out();
  if (created.length) out(`${colors.green("Created")}\n${created.map((file) => `  ${file}`).join("\n")}`);
  if (kept.length) out(`${colors.yellow("Kept the existing")}\n${kept.map((file) => `  ${file}`).join("\n")}`);
  if (gitignoreChanged) out(`${colors.green("Updated")} .gitignore`);
  out();
  out("Next steps:");
  out(`  1. ${cmd.add}`);
  out(`  2. ${cmd.exec} install chromium`);
  out(
    provider === "auto"
      ? "  3. Put one Jev provider's key in .env.local, such as TYPESAFE_API_KEY (never commit it)"
      : `  3. Put ${PROVIDERS[provider].keys} in .env.local (never commit it)`,
  );
  out(`  4. ${cmd.exec} test`);
  if (project.framework === "next" && project.typescript) {
    out();
    out(
      `Tip: next build type-checks every file tsconfig.json includes. To keep the tests out of it, add "e2e" and "intelliwright.config.ts" to "exclude" in tsconfig.json.`,
    );
  }
  out();
  return 0;
}

function updateGitignore(root: string): boolean {
  const file = path.join(root, ".gitignore");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return false;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(file, `${current}${prefix}${current ? "\n" : ""}# Intelliwright\n${missing.join("\n")}\n`);
  return true;
}

function configTemplate(
  project: ProjectInfo,
  provider: Provider,
  port: number,
  cmd: ReturnType<typeof commands>,
): string {
  const url = `http://localhost:${port}`;
  const webServer = project.devScript
    ? `  webServer: {
    command: "${cmd.run(project.devScript)}",
    url: "${url}",
    reuseExistingServer: true,
  },`
    : `  // Starts your app before the tests, and stops it afterwards:
  // webServer: { command: "npm run dev", url: "${url}", reuseExistingServer: true },`;
  const ai =
    provider === "auto"
      ? `  // With no provider set, the first Jev key found in the environment is used.
  // ai: { provider: "typesafe" },`
      : `  ai: { provider: "${provider}" }, // reads ${PROVIDERS[provider].keys}`;
  return `import { defineConfig } from "intelliwright";

export default defineConfig({
  testDir: "./e2e",
  baseURL: "${url}",
${webServer}
${ai}
  suites: { smoke: "@smoke" },
});
`;
}

const HOME_PAGE_TS = `import { BasePage } from "intelliwright";

export class HomePage extends BasePage {
  readonly path = "/";
  readonly heading = this.page.getByRole("heading", { level: 1 });
}
`;

const HOME_PAGE_JS = `import { BasePage } from "intelliwright";

export class HomePage extends BasePage {
  path = "/";
  heading = this.page.getByRole("heading", { level: 1 });
}
`;

const FIXTURES_TS = `import { test as base } from "intelliwright";
import { HomePage } from "./pages/home.page";

// Page objects that tests receive by name. The callback is called provide,
// not use, so React's hooks lint rule doesn't mistake it for a hook.
export const test = base.extend<{ homePage: HomePage }>({
  homePage: async ({ page, ai }, provide) => {
    await provide(new HomePage(page, ai));
  },
});

export { expect } from "intelliwright";
`;

const FIXTURES_JS = `import { test as base } from "intelliwright";
import { HomePage } from "./pages/home.page.mjs";

// Page objects that tests receive by name. The callback is called provide,
// not use, so React's hooks lint rule doesn't mistake it for a hook.
export const test = base.extend({
  homePage: async ({ page, ai }, provide) => {
    await provide(new HomePage(page, ai));
  },
});

export { expect } from "intelliwright";
`;

const HOME_TEST = `import { expect, test } from "./fixtures";

test.describe("home page", { tag: "@smoke" }, () => {
  test("shows its main heading", async ({ homePage }) => {
    await homePage.goto();
    await expect(homePage.heading).toBeVisible();
  });
});
`;
