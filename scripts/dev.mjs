import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
const secrets = existsSync(".env")
  ? parseEnv(readFileSync(".env", "utf8"))
  : {};
const workerKeys = [
  "JEV_API_KEY",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "DISCORD_APP_ID",
  "DISCORD_APP_PUBLIC_KEY",
  "DISCORD_BOT_TOKEN",
];
const existingVars = existsSync(".dev.vars")
  ? parseEnv(readFileSync(".dev.vars", "utf8"))
  : {};
const localVars = Object.fromEntries(
  workerKeys.flatMap((key) => {
    const value = secrets[key] || existingVars[key];
    return value ? [[key, value]] : [];
  }),
);
if (Object.keys(localVars).length)
  writeFileSync(
    ".dev.vars",
    Object.entries(localVars)
      .map(([key, value]) => key + "=" + JSON.stringify(value))
      .join(String.fromCharCode(10)) + String.fromCharCode(10),
    { mode: 0o600 },
  );
// Only allow intended variables. Testnet private keys are never forwarded to Vite.
const workerEnv = {
  ...process.env,
  ...localVars,
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  WRANGLER_SEND_METRICS: "false",
};
const viteEnv = {
  ...process.env,
  ...(secrets.VITE_WALLETCONNECT_PROJECT_ID
    ? { VITE_WALLETCONNECT_PROJECT_ID: secrets.VITE_WALLETCONNECT_PROJECT_ID }
    : {}),
};
const wrangler = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--port",
    "8787",
    "--test-scheduled",
  ],
  { env: workerEnv, stdio: "inherit", windowsHide: true },
);
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
  { env: viteEnv, stdio: "inherit", windowsHide: true },
);
let syncing = false;
setInterval(async () => {
  if (syncing) return;
  syncing = true;
  try {
    const response = await fetch(
      "http://127.0.0.1:8787/cdn-cgi/local/scheduled",
    );
    if (!response.ok)
      console.warn("Local chain synchronization is unavailable");
  } catch {
    /* The worker may still be starting. */
  } finally {
    syncing = false;
  }
}, 5000).unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    wrangler.kill();
    vite.kill();
    process.exit();
  });
