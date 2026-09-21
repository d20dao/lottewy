import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
const env = { ...parseEnv(readFileSync(".env", "utf8")), ...process.env };
const commands = [
  "docs/discord-command.json",
  "docs/discord-verify-command.json",
].map((path) => JSON.parse(readFileSync(path, "utf8")));
if (
  !/^\d{17,20}$/.test(env.DISCORD_APP_ID || "") ||
  !/^[a-f\d]{64}$/i.test(env.DISCORD_APP_PUBLIC_KEY || "") ||
  !env.DISCORD_BOT_TOKEN
)
  throw new Error("Discord configuration is incomplete");
const mode = process.argv[2] || "--preview";
if (
  !["--preview", "--check", "--publish"].includes(mode) ||
  process.argv.length > 3
)
  throw new Error("Use --preview, --check or --publish");
if (mode === "--preview") {
  console.log(
    JSON.stringify(
      {
        configured: true,
        published: false,
        commands,
        interactionPath: "/api/discord/interactions",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const headers = {
  Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "DiscordBot (https://lottewy.com, 1.0)",
};
const response = await fetch(
  "https://discord.com/api/v10/oauth2/applications/@me",
  { headers, redirect: "error", signal: AbortSignal.timeout(10000) },
);
if (!response.ok)
  throw new Error(`Discord identity check failed (${response.status})`);
const app = await response.json();
if (
  app.id !== env.DISCORD_APP_ID ||
  app.verify_key?.toLowerCase() !== env.DISCORD_APP_PUBLIC_KEY.toLowerCase()
)
  throw new Error("Discord token, application ID and public key do not match");
if (mode === "--check") {
  console.log(
    JSON.stringify({
      applicationMatches: true,
      publicKeyMatches: true,
      tokenValid: true,
      published: false,
    }),
  );
  process.exit(0);
}
if (env.DISCORD_PUBLISH_APPROVED !== "yes")
  throw new Error(
    "Publishing requires explicit approval and DISCORD_PUBLISH_APPROVED=yes",
  );
// Upsert this command only. Never bulk-overwrite unrelated application commands.
for (const command of commands) {
  const result = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(command),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!result.ok)
    throw new Error(`Discord command publication failed (${result.status})`);
  console.log(JSON.stringify({ published: true, command: command.name }));
}
