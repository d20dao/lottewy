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
  canPostInChannel,
  discordLinks,
  discordRoles,
  recoverCampaignMessage,
} from "../worker/discord-campaigns";
import { loadJson } from "../worker/storage";
import { hash } from "../shared/core";
import { CHAIN_ID, COORDINATOR, select } from "../shared/core";
import { expireDiscordRegistrations } from "../worker/discord-retention";
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
          roles: [
            { id: guild, permissions: "84992" },
            { id: "777777777777777777", permissions: "32" },
          ],
        });
      if (path.endsWith("/members/" + verifier))
        return Response.json({ roles: [] });
      if (path.endsWith("/members/888888888888888888"))
        return Response.json({ roles: ["777777777777777777"] });
      if (path.endsWith("/members/" + app)) return Response.json({ roles: [] });
      if (path.endsWith("/channels/" + channel))
        return Response.json({
          id: channel,
          guild_id: guild,
          type: 0,
          name: "giveaways",
        });
      if (path.endsWith("/messages/" + message) && options.method === "GET")
        return Response.json({
          author: { id: app },
          channel_id: channel,
          components: posts.at(-1)?.components,
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
it("filters channels using effective bot overwrites, not just server permissions", () => {
  const g = {
      id: guild,
      roles: [
        { id: guild, permissions: "84992" },
        { id: "role", permissions: "0" },
      ],
    },
    member = { roles: ["role"] },
    c = { guild_id: guild, type: 0, permission_overwrites: [] as any[] };
  expect(canPostInChannel(g, member, app, c)).toBe(true);
  c.permission_overwrites = [{ id: guild, type: 0, deny: "2048", allow: "0" }];
  expect(canPostInChannel(g, member, app, c)).toBe(false);
  c.permission_overwrites.push({
    id: "role",
    type: 0,
    deny: "0",
    allow: "2048",
  });
  expect(canPostInChannel(g, member, app, c)).toBe(true);
  c.permission_overwrites.push({ id: app, type: 1, deny: "1024", allow: "0" });
  expect(canPostInChannel(g, member, app, c)).toBe(false);
  expect(canPostInChannel(g, member, app, { ...c, guild_id: "other" })).toBe(
    false,
  );
});
it("lets independent authorized wallets link the same server without sharing their links or codes", async () => {
  const secondOwner = "0x0000000000000000000000000000000000000002";
  db.sqlite
    .prepare("INSERT INTO users(address,created) VALUES (?,?)")
    .run(secondOwner, clock);
  const first = await linkChallenge(env, owner),
    second = await linkChallenge(env, secondOwner);
  const signedMember = {
    ...interaction(),
    member: { permissions: "32", user: { id: verifier } },
  };
  await verifyChannel(env, signedMember, first.code);
  await verifyChannel(
    env,
    {
      ...signedMember,
      member: { permissions: "32", user: { id: "888888888888888888" } },
    },
    second.code,
  );
  const firstLinks = await discordLinks(env, owner),
    secondLinks = await discordLinks(env, secondOwner);
  expect(firstLinks).toHaveLength(1);
  expect(secondLinks).toHaveLength(1);
  expect(firstLinks[0].guildId).toBe(secondLinks[0].guildId);
  expect(firstLinks[0].id).not.toBe(secondLinks[0].id);
  await expect(verifyChannel(env, signedMember, first.code)).rejects.toThrow(
    "already used",
  );
  await expect(
    campaignCreate(
      env,
      secondOwner,
      crypto.randomUUID(),
      {
        title: "Community event",
        description: "",
        rules: "Free community participation.",
        winners: 1,
        reserves: 0,
        listed: false,
        linkId: firstLinks[0].id,
        endsAt: clock + 300,
      },
      {},
    ),
  ).rejects.toThrow("Verify");
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
  await expect(discordRoles(env, owner, link.id)).rejects.toThrow(
    "Manage Server",
  );
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

it("recovers lost announcement IDs after cancellation or expiry without reopening entries", async () => {
  const { id } = await create();
  failPost = true;
  await processDiscordCampaigns(env);
  db.sqlite
    .prepare(
      "UPDATE discord_campaigns SET status='cancelled',closed_at=? WHERE id=?",
    )
    .run(clock, id);
  const prepared = await recoverCampaignMessage(env, owner, id, message);
  await env.DB.batch([...prepared, env.DB.prepare("DELETE FROM atomic_guard")]);
  expect((await campaignRow(env, id))!.status).toBe("cancelled");
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].description).toContain("cancelled");
  db.sqlite
    .prepare(
      "UPDATE discord_campaigns SET status='expired',message_id=NULL WHERE id=?",
    )
    .run(id);
  await env.DB.batch([
    ...(await recoverCampaignMessage(env, owner, id, message)),
    env.DB.prepare("DELETE FROM atomic_guard"),
  ]);
  expect((await campaignRow(env, id))!.status).toBe("expired");
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].description).toContain("Expired");
  expect(posts).toHaveLength(1);
});

it("expires an early cancellation 30 days after cancellation, not 30 days after the planned deadline", async () => {
  const { id } = await create();
  db.sqlite
    .prepare(
      "UPDATE discord_campaigns SET status='cancelled',closed_at=?,ends_at=? WHERE id=?",
    )
    .run(clock, clock + 2592000, id);
  clock += 2592000;
  await expireDiscordRegistrations(env);
  expect((await campaignRow(env, id))!.status).toBe("expired");
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

it("enforces any-of required roles on joining but always permits leaving before close", async () => {
  const { id } = await create();
  await processDiscordCampaigns(env);
  const row = (await campaignRow(env, id))!,
    input = JSON.parse(row.input_json);
  input.roleIds = ["111111111111111111", "222222222222222222"];
  db.sqlite
    .prepare("UPDATE discord_campaigns SET input_json=? WHERE id=?")
    .run(JSON.stringify(input), id);
  await expect(participantAction(env, interaction(), id, true)).rejects.toThrow(
    "required server roles",
  );
  const member = interaction();
  (member.member as any).roles = ["222222222222222222"];
  expect(await participantAction(env, member, id, true)).toContain(
    "You are in",
  );
  expect(await participantAction(env, interaction(), id, false)).toContain(
    "removed",
  );
});

it("edits the original message through waiting, pending and winners without duplicate sends", async () => {
  const { id, input } = await create();
  await processDiscordCampaigns(env);
  await participantAction(env, interaction(), id, true);
  await participantAction(env, interaction("789012345678901234"), id, true);
  clock = input.endsAt;
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].description).toContain(
    "Waiting for the organizer",
  );
  db.sqlite.prepare("UPDATE giveaways SET status='pending' WHERE id=?").run(id);
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].description).toContain("Draw in progress");
  const g = JSON.parse(
    (
      db.sqlite
        .prepare("SELECT public_json FROM giveaways WHERE id=?")
        .get(id) as any
    ).public_json,
  );
  g.status = "completed";
  g.evidence = {
    chainId: CHAIN_ID,
    coordinator: COORDINATOR,
    consumer: owner,
    word: "0x" + "01".repeat(32),
    txHash: "0x" + "02".repeat(32),
    requestId: "1",
  };
  db.sqlite
    .prepare("UPDATE giveaways SET status='completed',public_json=? WHERE id=?")
    .run(JSON.stringify(g), id);
  await processDiscordCampaigns(env);
  const message = patches.at(-1);
  expect(message.embeds[0].description).toContain("draw is complete");
  const winner = select(g.manifest, g.evidence.word, g.commitment).winners[0];
  expect(message.embeds[0].fields[0].value).toContain(
    winner === 1 ? "678901234567890123" : "789012345678901234",
  );
  expect(
    message.components[0].components.some((b: any) =>
      b.url.endsWith("?verify=1"),
    ),
  ).toBe(true);
  expect(message.allowed_mentions).toEqual({ parse: [] });
  expect(posts).toHaveLength(1);
  const count = patches.length;
  await processDiscordCampaigns(env);
  expect(patches).toHaveLength(count);
  db.sqlite.prepare("UPDATE giveaways SET hidden=1 WHERE id=?").run(id);
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].title).toBe("Giveaway unavailable");
});

it("purges an undrawn roster after 30 days, updates Discord, and preserves started records", async () => {
  const { id, input } = await create();
  await processDiscordCampaigns(env);
  await participantAction(env, interaction(), id, true);
  await participantAction(env, interaction("789012345678901234"), id, true);
  clock = input.endsAt;
  await processDiscordCampaigns(env);
  clock = input.endsAt + 2591999;
  await expireDiscordRegistrations(env);
  expect((await campaignRow(env, id))!.status).toBe("ready");
  db.sqlite.prepare("UPDATE giveaways SET status='pending' WHERE id=?").run(id);
  clock++;
  await expireDiscordRegistrations(env);
  expect((await campaignRow(env, id))!.status).toBe("ready");
  db.sqlite.prepare("UPDATE giveaways SET status='draft' WHERE id=?").run(id);
  await expireDiscordRegistrations(env);
  expect((await campaignRow(env, id))!.status).toBe("expired");
  for (const table of [
    "giveaways",
    "revisions",
    "discord_entries",
    "json_chunks",
  ])
    expect(
      (db.sqlite.prepare("SELECT COUNT(*) n FROM " + table).get() as any).n,
    ).toBe(0);
  await processDiscordCampaigns(env);
  expect(patches.at(-1).embeds[0].description).toContain(
    "Expired. No draw was started.",
  );
  expect(posts).toHaveLength(1);
});
