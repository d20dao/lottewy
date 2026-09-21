import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const origin = "https://testnet.lottewy.com";
const env = { ...process.env, VITE_PUBLIC_ORIGIN: origin };
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
for (const path of ["dist/index.html", "dist/robots.txt", "dist/sitemap.xml"])
  writeFileSync(
    path,
    readFileSync(path, "utf8").replaceAll("https://lottewy.com", origin),
  );
