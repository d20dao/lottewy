import giveaway from "../docs/discord-command.json";
import verify from "../docs/discord-verify-command.json";
import { discordApi, type CampaignEnv } from "./discord-campaigns";
export async function registerDiscordCommands(env: CampaignEnv) {
  const app = await discordApi(env, "/oauth2/applications/@me");
  if (
    app.id !== env.DISCORD_APP_ID ||
    app.verify_key?.toLowerCase() !== env.DISCORD_APP_PUBLIC_KEY?.toLowerCase()
  )
    throw new Error("Discord application identity mismatch");
  // Name-based upserts are retry-safe; unrelated commands are never removed.
  for (const command of [giveaway, verify])
    await discordApi(
      env,
      `/applications/${env.DISCORD_APP_ID}/commands`,
      "POST",
      command,
    );
  const registered = await discordApi(
    env,
    `/applications/${env.DISCORD_APP_ID}/commands`,
  );
  if (
    ![giveaway, verify].every((c) =>
      registered.some((r: any) => r.name === c.name && r.type === c.type),
    )
  )
    throw new Error("Discord command registration is not confirmed");
  return { registered: ["giveaway", "verify"] };
}
