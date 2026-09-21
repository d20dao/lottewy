import { execFileSync } from "node:child_process";
const env = {
  ...process.env,
  LOTTEWY_NETWORK: "mainnet",
  VITE_PUBLIC_ORIGIN: "https://lottewy.com",
};
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  { stdio: "inherit", env, windowsHide: true },
);
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
