import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { rmSync, existsSync } from "node:fs";
const index = resolve("artifacts/policy-test-index");
const env = { ...process.env, GIT_INDEX_FILE: index };
const git = (args) => execFileSync("git", args, { env, stdio: "pipe" });
try {
  git(["read-tree", "--empty"]);
  git(["add", "--force", "--", "docs/DECISIONS.md"]);
  let blocked = false;
  try {
    execFileSync(process.execPath, ["scripts/check-staged-docs.mjs"], {
      env,
      stdio: "pipe",
    });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error("Private Markdown was not blocked");
  git(["read-tree", "--empty"]);
  git(["add", "--", "README.md"]);
  execFileSync(process.execPath, ["scripts/check-staged-docs.mjs"], {
    env,
    stdio: "pipe",
  });
  console.log(
    "Repository policy test passed: private Turkish Markdown blocked; English README allowed. Real index untouched.",
  );
} finally {
  if (existsSync(index)) rmSync(index);
  if (existsSync(index + ".lock")) rmSync(index + ".lock");
}
