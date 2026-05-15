import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const cliArgs = process.argv.slice(2);
const hasWorkerArg = cliArgs.some((arg) => arg === "--workers" || arg.startsWith("--workers="));
const args = ["test", ...(hasWorkerArg ? [] : ["--workers=1"]), ...cliArgs];

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServerReady() {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(processRef) {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (processRef.exitCode !== null) {
      throw new Error(`Next dev server exited early with code ${processRef.exitCode}`);
    }
    if (await isServerReady()) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function run(command, commandArgs, options = {}) {
  return spawn(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });
}

function killTree(child) {
  if (!child?.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", shell: true });
    return;
  }

  child.kill("SIGTERM");
}

async function restoreNextEnvImport() {
  const path = new URL("../next-env.d.ts", import.meta.url);
  const content = await readFile(path, "utf8");
  const restored = content.replace('import "./.next/dev/types/routes.d.ts";', 'import "./.next/types/routes.d.ts";');
  if (restored !== content) {
    await writeFile(path, restored);
  }
}

async function main() {
  let server = null;
  const alreadyRunning = await isServerReady();

  if (!alreadyRunning) {
    server = run("node", ["./node_modules/next/dist/bin/next", "dev", "--hostname", "localhost", "--port", "3000"]);
    await waitForServer(server);
  }

  const playwright = run("node", ["./node_modules/@playwright/test/cli.js", ...args], {
    env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl }
  });

  const exitCode = await new Promise((resolve) => {
    playwright.on("exit", (code) => resolve(code ?? 1));
  });

  if (server) {
    killTree(server);
    await sleep(500);
  }

  await restoreNextEnvImport();
  process.exit(exitCode);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await restoreNextEnvImport().catch(() => undefined);
  process.exit(1);
});
