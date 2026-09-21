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
// Test deployments must not compete with the public site's search presence.
const html = readFileSync("dist/index.html", "utf8")
  .replace(/(<meta name="robots" content=")[^"]*(")/g, "$1noindex,nofollow$2")
  .replace(/<link rel="canonical"[^>]*>/g, "")
  .replace(/<meta property="og:url"[^>]*>/g, "")
  .replace(/<script id="site-schema"[\s\S]*?<\/script>/g, "");
writeFileSync("dist/index.html", html);
writeFileSync("dist/robots.txt", "User-agent: *\nAllow: /\nDisallow: /api/\n");
writeFileSync(
  "dist/sitemap.xml",
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n',
);
