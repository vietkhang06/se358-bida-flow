// Starts an isolated local Wrangler Worker + local D1 instance, applies migration,
// runs a target Node script against its URL, and always cleans up the server & temp state.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetScript = process.argv[2];
if (!targetScript) {
  console.error("Usage: node scripts/with-local-wrangler.mjs <script-path>");
  process.exit(1);
}

const port = Number(process.env.BIDAFLOW_LOCAL_PORT ?? 8788);
const baseUrl = `http://127.0.0.1:${port}`;
const setupCode = process.env.BIDAFLOW_TEST_SETUP_CODE ?? "bidaflow-local-qa-setup-code";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bidaflow-wrangler-"));
const persistDir = path.join(tempRoot, "state");
const runtimeDir = path.join(tempRoot, "runtime");
fs.mkdirSync(persistDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const wranglerConfig = path.join(root, "dist", "server", "wrangler.json");
const migrationSql = path.join(root, "drizzle", "0000_natural_silvermane.sql");

if (!fs.existsSync(wranglerConfig)) {
  console.error("Missing dist/server/wrangler.json. Run `pnpm build` first.");
  process.exit(1);
}

const sharedEnv = {
  ...process.env,
  SITES_RUNTIME_ROOT: runtimeDir,
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: path.join(runtimeDir, "logs"),
  WRANGLER_REGISTRY_PATH: path.join(runtimeDir, "dev-registry"),
  MINIFLARE_REGISTRY_PATH: path.join(runtimeDir, "registry"),
  XDG_CONFIG_HOME: path.join(runtimeDir, "xdg"),
  SETUP_CODE: setupCode,
};

function cleanupDir() {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Ignore locked temp handles on Windows exit
  }
}

const migrate = spawnSync(
  process.execPath,
  [
    wranglerBin,
    "d1",
    "execute",
    "DB",
    "--local",
    "--config",
    wranglerConfig,
    "--persist-to",
    persistDir,
    "--file",
    migrationSql,
  ],
  { cwd: root, env: sharedEnv, encoding: "utf8" },
);

if (migrate.status !== 0) {
  console.error("Local D1 migration failed:", migrate.stdout, migrate.stderr);
  cleanupDir();
  process.exit(migrate.status ?? 1);
}

const worker = spawn(
  process.execPath,
  [
    wranglerBin,
    "dev",
    "--config",
    wranglerConfig,
    "--local",
    "--persist-to",
    persistDir,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    "0",
    "--var",
    `SETUP_CODE:${setupCode}`,
  ],
  { cwd: root, env: sharedEnv, stdio: ["ignore", "pipe", "pipe"] },
);

let workerLogs = "";
worker.stdout.on("data", (chunk) => { workerLogs += chunk.toString(); });
worker.stderr.on("data", (chunk) => { workerLogs += chunk.toString(); });

async function waitUntilReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(`Wrangler exited early (${worker.exitCode}):\n${workerLogs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/auth/status`);
      if (res.status === 200) return;
    } catch {
      // Server still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for Wrangler at ${baseUrl}:\n${workerLogs}`);
}

let exitCode = 1;
try {
  await waitUntilReady();
  const child = spawnSync(process.execPath, [path.resolve(root, targetScript)], {
    cwd: root,
    env: {
      ...sharedEnv,
      BIDAFLOW_TEST_URL: baseUrl,
      BIDAFLOW_E2E_URL: baseUrl,
      BIDAFLOW_PERF_URL: baseUrl,
      BIDAFLOW_TEST_SETUP_CODE: setupCode,
    },
    stdio: "inherit",
  });
  exitCode = child.status ?? 1;
} finally {
  if (worker.exitCode === null) {
    worker.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  cleanupDir();
}
process.exit(exitCode);
