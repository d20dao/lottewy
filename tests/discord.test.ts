import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { database } from "./d1";
import { discordInteraction, giveawayMessage } from "../worker/discord";
import {
  hash,
  makeManifest,
  CHAIN_ID,
  COORDINATOR,
  type Giveaway,
} from "../shared/core";
const appId = "123456789012345678",
  guildId = "234567890123456789",
  consumer = "0x0000000000000000000000000000000000000001";
let db: ReturnType<typeof database>,
  env: any,
  keys: CryptoKeyPair,
  tasks: Promise<unknown>[],
  sent: any[];
beforeEach(async () => {
  db = database();
  tasks = [];
  sent = [];
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  env = {
    DB: db,
    APP_ORIGIN: "https://lottewy.com",
    CONSUMER_ADDRESS: consumer,
    DISCORD_APP_ID: appId,
    DISCORD_APP_PUBLIC_KEY: Buffer.from(
      await crypto.subtle.exportKey("raw", keys.publicKey),
    ).toString("hex"),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, options: any) => {
      expect(String(url)).toMatch(
        /^https:\/\/discord.com\/api\/v10\/webhooks\//,
      );
      expect(options.method).toBe("PATCH");
      sent.push(JSON.parse(options.body));
      return Response.json({ id: "message" });
    }),
  );
});
afterEach(async () => {
  await Promise.all(tasks);
  vi.unstubAllGlobals();
  db.sqlite.close();
});
const context = () => ({
  waitUntil: (task: Promise<unknown>) => tasks.push(task),
});
const command = (id: string, interactionId = "345678901234567890") => ({
  id: interactionId,
  application_id: appId,
  guild_id: guildId,
  token: "synthetic-interaction-token",
  type: 2,
  data: { name: "giveaway", options: [{ name: "id", type: 3, value: id }] },
});
async function signed(
  value: any,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const text = JSON.stringify(value),
    signature = Buffer.from(
      await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        new TextEncoder().encode(timestamp + text),
      ),
    ).toString("hex");
  return new Request("https://lottewy.com/api/discord/interactions", {
    method: "POST",
    headers: {
      "X-Signature-Timestamp": timestamp,
      "X-Signature-Ed25519": signature,
    },
    body: text,
  });
}
function fixture(winners = 2, reserves = 1) {
  const id = crypto.randomUUID(),
    owner = consumer,
    entries = Array.from(
      { length: Math.max(4, winners + reserves) },
      (_, i) => `Private Person ${i + 1}`,
    );
  const built = makeManifest(
    {
      title: "Community draw @everyone",
      description: "",
      rules: "Free community entries, equal chances.",
      entries,
      winners,
      reserves,
    },
    id,
    owner,
    1,
  );
  const g: Giveaway = {
    id,
    slug: id,
    owner,
    revision: 1,
    status: "completed",
    created: 1,
    review: { mode: "local", model: "none", policy: "test" },
    manifest: built.manifest,
    commitment: built.commitment,
    evidence: {
      word: hash("word"),
      chainId: CHAIN_ID,
      coordinator: COORDINATOR,
      consumer,
      requestId: "42",
      txHash: hash("request"),
      blockHash: hash("block"),
      blockNumber: "1",
    },
  };
  db.sqlite
    .prepare("INSERT INTO users(address,created) VALUES (?,1)")
    .run(owner);
  db.sqlite
    .prepare(
      "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created) VALUES (?,?,?,1,'completed',?,'{}',1)",
    )
    .run(id, id, owner, JSON.stringify(g));
  return { g, entries };
}
it("verifies raw-body signatures and timestamps, answers Ping, and rejects tampering", async () => {
  expect(
    await (
      await discordInteraction(await signed({ type: 1 }), env, context())
    ).json(),
  ).toEqual({ type: 1 });
  const request = await signed({ type: 1 });
  expect(
    (
      await discordInteraction(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: '{"type":2}',
        }),
        env,
        context(),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await discordInteraction(
        await signed({ type: 1 }, String(Math.floor(Date.now() / 1000) - 600)),
        env,
        context(),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await discordInteraction(
        await signed({ type: 1, application_id: "other" }),
        env,
        context(),
      )
    ).status,
  ).toBe(401);
  expect(tasks).toHaveLength(0);
  expect(sent).toHaveLength(0);
});
it("defers a signed command, displays public selections without mentions/raw names, and deduplicates retries", async () => {
  const { g, entries } = fixture(),
    payload = command(g.id);
  expect(
    await (
      await discordInteraction(await signed(payload), env, context())
    ).json(),
  ).toEqual({ type: 5 });
  await Promise.all(tasks);
  expect(sent).toHaveLength(1);
  expect(sent[0].allowed_mentions).toEqual({ parse: [] });
  expect(sent[0].embeds[0].fields[0].name).toBe("🏆 Winners");
  for (const entry of entries)
    expect(JSON.stringify(sent[0])).not.toContain(entry);
  expect(
    JSON.stringify(
      db.sqlite.prepare("SELECT * FROM discord_interactions").all(),
    ),
  ).not.toContain(payload.token);
  await discordInteraction(await signed(payload), env, context());
  await Promise.all(tasks);
  expect(sent).toHaveLength(1);
});
it("hides moderated records and never exposes a pending draw as winners", async () => {
  const { g } = fixture();
  db.sqlite.prepare("UPDATE giveaways SET hidden=1").run();
  await discordInteraction(await signed(command(g.id)), env, context());
  await Promise.all(tasks);
  expect(sent[0].embeds).toEqual([]);
  expect(JSON.stringify(sent[0])).not.toContain(g.manifest.title);
  const pending = giveawayMessage(
    env,
    { ...g, status: "draft" },
    { id: g.id, page: 1 },
    "web",
  );
  expect(pending.content).toContain("no completed result");
  expect(pending.embeds).toEqual([]);
});
it("bounds result pages and component IDs, and refuses altered manifests or another chain", () => {
  const { g } = fixture(100, 100);
  const message = giveawayMessage(env, g, { id: g.id, page: 1 }, "web") as any;
  expect(message.embeds[0].fields[0].value.split("\n")).toHaveLength(10);
  expect(message.embeds[0].fields[0].value.length).toBeLessThanOrEqual(1024);
  expect(message.components[1].components[1].custom_id).toBe(
    `lw:web:${g.id}:2`,
  );
  expect(JSON.stringify(message).length).toBeLessThan(6000);
  expect(() =>
    giveawayMessage(
      env,
      { ...g, manifest: { ...g.manifest, title: "Changed" } },
      { id: g.id, page: 1 },
      "web",
    ),
  ).toThrow();
  expect(() =>
    giveawayMessage(
      env,
      { ...g, evidence: { ...g.evidence!, chainId: 1 } },
      { id: g.id, page: 1 },
      "web",
    ),
  ).toThrow();
});
it("updates the original message for pagination and rejects non-UUID input privately", async () => {
  const { g } = fixture(12, 0);
  const component = {
    ...command(g.id),
    type: 3,
    data: { custom_id: `lw:web:${g.id}:2` },
  };
  expect(
    await (
      await discordInteraction(await signed(component), env, context())
    ).json(),
  ).toEqual({ type: 6 });
  await Promise.all(tasks);
  expect(sent[0].embeds[0].footer.text).toContain("Page 2/2");
  const invalid = await discordInteraction(
    await signed(command("https://elsewhere.invalid")),
    env,
    context(),
  );
  expect(await invalid.json()).toMatchObject({ type: 4, data: { flags: 64 } });
  expect(tasks).toHaveLength(1);
});
