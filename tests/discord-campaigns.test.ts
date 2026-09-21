import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { database } from "./d1";
import {
  campaignCreate,
  campaignRow,
  linkChallenge,
  participantAction,
  processDiscordCampaigns,
  publicCampaign,
  verifyChannel,
} from "../worker/discord-campaigns";
import { loadJson } from "../worker/storage";
import { hash } from "../shared/core";
const owner = "0x0000000000000000000000000000000000000001",
  app = "123456789012345678",
  guild = "234567890123456789",
  channel = "345678901234567890",
  verifier = "456789012345678901",
  message = "567890123456789012";
let db: ReturnType<typeof database>,
  env: any,
  clock: number,
  posts: any[],
  patches: any[],
  failPost: boolean,
  hasManager: boolean;
beforeEach(() => {
  db = database();
  clock = Math.floor(Date.now() / 1000);
  db.sqlite.function("unixepoch", () => clock);
  db.sqlite
    .prepare("INSERT INTO users(address,created) VALUES (?,?)")
    .run(owner, clock);
  env = {
    DB: db,
    APP_ORIGIN: "https://lottewy.com",
    CONSUMER_ADDRESS: owner,
    DISCORD_APP_ID: app,
    DISCORD_APP_PUBLIC_KEY: "11".repeat(32),
    DISCORD_BOT_TOKEN: "synthetic-token",
  };
  posts = [];
  patches = [];
  failPost = false;
  hasManager = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      const path = new URL(String(url)).pathname;
      expect(String(url)).toMatch(/^https:\/\/discord.com\/api\/v10\//);
      if (path.endsWith("/oauth2/applications/@me"))
        return Response.json({
          id: app,
          verify_key: env.DISCORD_APP_PUBLIC_KEY,
          bot: { id: app },
        });
      if (path.endsWith("/guilds/" + guild))
        return Response.json({
          id: guild,
          name: "Test community",
          owner_id: hasManager ? verifier : "999999999999999999",
          roles: [{ id: guild, permissions: "0" }],
        });
      if (path.endsWith("/members/" + verifier))
        return Response.json({ roles: [] });
      if (path.endsWith("/channels/" + channel))
        return Response.json({
          id: channel,
          guild_id: guild,
          type: 0,
          name: "giveaways",
        });
      if (options.method === "POST" && path.endsWith("/messages")) {
        posts.push(JSON.parse(options.body));
        if (failPost) throw new Error("Lost reply");
        return Response.json({ id: message, channel_id: channel });
      }
      if (options.method === "PATCH") {
        patches.push(JSON.parse(options.body));
        return Response.json({ id: message });
      }
      throw new Error("Unexpected Discord route");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.sqlite.close();
});

it("does not publish for a suspended organizer and cannot reopen a cancelled uncertain announcement", async () => {
  const first = await create();
  db.sqlite.prepare("UPDATE users SET suspended=1 WHERE address=?").run(owner);
  await processDiscordCampaigns(env);
  expect(posts).toHaveLength(0);
  expect((await campaignRow(env, first.id))!.status).toBe("cancelled");
  db.sqlite.prepare("UPDATE users SET suspended=0 WHERE address=?").run(owner);
  const second = await create();
  failPost = true;
  await processDiscordCampaigns(env);
  db.sqlite
    .prepare("UPDATE discord_campaigns SET status='cancelled' WHERE id=?")
    .run(second.id);
  expect(
    await participantAction(env, interaction(), second.id, true),
  ).toContain("closed");
  expect((await campaignRow(env, second.id))!.status).toBe("cancelled");
  expect((await campaignRow(env, second.id))!.participant_count).toBe(0);
  await processDiscordCampaigns(env);
  expect(posts).toHaveLength(1);
  expect(patches.at(-1).components).toHaveLength(1);
});
const interaction = (user = "678901234567890123") => ({
  application_id: app,
  guild_id: guild,
  channel_id: channel,
  member: {
    permissions: "32",
    user: { id: user, username: "Member " + user.slice(-2), bot: false },
  },
  message: { id: message },
});
async function create(winners = 1, reserves = 0) {
  const challenge = await linkChallenge(env, owner);
  await verifyChannel(
    env,
    { ...interaction(), member: { permissions: "32", user: { id: verifier } } },
    challenge.code,
  );
  const link = db.sqlite.prepare("SELECT id FROM discord_links").get() as any,
    id = crypto.randomUUID();
  const input = {
    title: "Community event",
    description: "",
    rules:
      "Free entries. One entry per Discord account. The organizer delivers the prize.",
    winners,
    reserves,
    listed: false,
    linkId: link.id,
    endsAt: clock + 300,
  };
  const prepared = await campaignCreate(env, owner, id, input, {
    mode: "local",
    model: "none",
    policy: "test",
  });
  await env.DB.batch([
    ...prepared.statements,
    env.DB.prepare("DELETE FROM atomic_guard"),
  ]);
  return { id, input };
}
it("requires Manage Server permission, consumes verification once, and rechecks current permissions before publishing", async () => {
  const challenge = await linkChallenge(env, owner);
  await expect(
    verifyChannel(
      env,
      {
        ...interaction(),
        member: { permissions: "0", user: { id: verifier } },
      },
      challenge.code,
    ),
  ).rejects.toThrow("Manage Server");
  await verifyChannel(
    env,
    { ...interaction(), member: { permissions: "32", user: { id: verifier } } },
    challenge.code,
  );
  await expect(
    verifyChannel(env, interaction(), challenge.code),
  ).rejects.toThrow("expired");
  const link = db.sqlite.prepare("SELECT id FROM discord_links").get() as any;
  hasManager = false;
  await expect(
    campaignCreate(
      env,
      owner,
      crypto.randomUUID(),
      {
        title: "Community event",
        description: "",
        rules: "Free community participation.",
        winners: 1,
        reserves: 0,
        listed: false,
        linkId: link.id,
        endsAt: clock + 300,
      },
      {},
    ),
  ).rejects.toThrow("no longer");
  expect(posts).toHaveLength(0);
});
it("records one entry per user, permits leaving only before cutoff, and freezes a normal giveaway without starting a draw", async () => {
  const { id, input } = await create();
  await processDiscordCampaigns(env);
  expect(posts).toHaveLength(1);
  expect(posts[0].allowed_mentions).toEqual({ parse: [] });
  expect(posts[0].nonce.length).toBeLessThanOrEqual(25);
  await participantAction(env, interaction(), id, true);
  await participantAction(env, interaction(), id, true);
  expect((await campaignRow(env, id))!.participant_count).toBe(1);
  await participantAction(env, interaction(), id, false);
  await participantAction(env, interaction(), id, false);
  expect((await campaignRow(env, id))!.participant_count).toBe(0);
  await participantAction(env, interaction(), id, true);
  await participantAction(env, interaction("789012345678901234"), id, true);
  clock = input.endsAt;
  expect(
    await participantAction(env, interaction("890123456789012345"), id, true),
  ).toContain("closed");
  expect(await participantAction(env, interaction(), id, false)).toContain(
    "closed",
  );
  await processDiscordCampaigns(env);
  const campaign = (await campaignRow(env, id))!;
  expect(campaign.status).toBe("ready");
  expect(campaign.participant_count).toBe(2);
  const row = db.sqlite
      .prepare("SELECT * FROM giveaways WHERE id=?")
      .get(id) as any,
    g = JSON.parse(row.public_json);
  expect(g.status).toBe("draft");
  expect(g.registration).toMatchObject({ kind: "discord", campaignId: id });
  expect(hash(g.manifest)).toBe(g.commitment);
  const archive = (await loadJson(env.DB, row.private_json)) as any;
  expect(archive.draft.entries).toHaveLength(2);
  expect(archive.draft.entries[0]).toContain("678901234567890123");
  expect(JSON.stringify(publicCampaign(campaign))).not.toContain(
    "678901234567890123",
  );
  expect(
    db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get(),
  ).toMatchObject({ n: 0 });
  const before = g.commitment;
  await processDiscordCampaigns(env);
  expect(
    JSON.parse(
      (db.sqlite.prepare("SELECT public_json FROM giveaways").get() as any)
        .public_json,
    ).commitment,
  ).toBe(before);
  expect(patches.at(-1).components).toHaveLength(1);
});
it("does not re-post after an uncertain announcement and accepts a signed click on that original message as recovery", async () => {
  const { id } = await create();
  failPost = true;
  await processDiscordCampaigns(env);
  await processDiscordCampaigns(env);
  expect(posts).toHaveLength(1);
  expect((await campaignRow(env, id))!.status).toBe("publishing_uncertain");
  await expect(
    participantAction(
      env,
      { ...interaction(), channel_id: "999999999999999999" },
      id,
      true,
    ),
  ).rejects.toThrow("channel");
  expect(await participantAction(env, interaction(), id, true)).toContain(
    "You are in",
  );
  expect((await campaignRow(env, id))!.status).toBe("open");
});
it("never prepares a draw with too few participants and excludes bot accounts", async () => {
  const { id, input } = await create(3, 1);
  await processDiscordCampaigns(env);
  await expect(
    participantAction(
      env,
      { ...interaction(), member: { user: { id: verifier, bot: true } } },
      id,
      true,
    ),
  ).rejects.toThrow("own Discord account");
  await participantAction(env, interaction(), id, true);
  clock = input.endsAt + 1;
  await processDiscordCampaigns(env);
  expect((await campaignRow(env, id))!.status).toBe("insufficient");
  expect(
    db.sqlite.prepare("SELECT COUNT(*) n FROM giveaways").get(),
  ).toMatchObject({ n: 0 });
});
