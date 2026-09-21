import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { database } from "./d1";
import { campaignRow } from "../worker/discord-campaigns";
import {
  queueWinnerNotifications,
  sendWinnerNotifications,
} from "../worker/discord-notifications";
let db: ReturnType<typeof database>,
  env: any,
  row: any,
  clock: number,
  calls: any[];
beforeEach(async () => {
  db = database();
  clock = Math.floor(Date.now() / 1000);
  db.sqlite.function("unixepoch", () => clock);
  const owner = "0x0000000000000000000000000000000000000001",
    id = crypto.randomUUID();
  db.sqlite
    .prepare("INSERT INTO users(address,created) VALUES (?,?)")
    .run(owner, clock);
  db.sqlite
    .prepare(
      "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created) VALUES (?,?,?,1,'completed','{}','{}',?)",
    )
    .run(id, id, owner, clock);
  db.sqlite
    .prepare(
      "INSERT INTO discord_campaigns(id,owner,status,input_json,payload_hash,guild_id,channel_id,ends_at,created,review_json,message_id,lease_token,lease_until) VALUES (?,?,'ready','{}','hash','123456789012345678','234567890123456789',?,?,'{}','345678901234567890','lease',?)",
    )
    .run(id, owner, clock, clock, clock + 60);
  env = {
    DB: db,
    APP_ORIGIN: "https://testnet.lottewy.com",
    DISCORD_BOT_TOKEN: "test-token",
  };
  row = await campaignRow(env, id);
  calls = [];
  await env.DB.batch(
    queueWinnerNotifications(
      env,
      row,
      Array.from({ length: 100 }, (_, i) =>
        String(100000000000000000n + BigInt(i)),
      ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.sqlite.close();
});
it("bounds winner-only mentions and never repeats a notification with an uncertain reply", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: any, options: any) => {
      calls.push(JSON.parse(options.body));
      if (calls.length === 2) throw new Error("Lost reply");
      return Response.json({ id: "456789012345678901" });
    }),
  );
  await sendWinnerNotifications(env, row, "lease");
  await sendWinnerNotifications(env, row, "lease");
  expect(calls).toHaveLength(2);
  expect(
    calls.every(
      (c) =>
        c.content.length < 2000 &&
        c.allowed_mentions.users.length === 50 &&
        c.allowed_mentions.parse.length === 0 &&
        c.allowed_mentions.replied_user === false,
    ),
  ).toBe(true);
  expect(
    db.sqlite
      .prepare("SELECT state FROM discord_notifications ORDER BY batch_index")
      .all(),
  ).toEqual([{ state: "sent" }, { state: "uncertain" }]);
  expect((await campaignRow(env, row.id))!.error_code).toBe(
    "WINNER_NOTIFICATION_UNCERTAIN",
  );
});
it("respects rate-limit backoff and reuses the same nonce without duplicate successful notices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: any, options: any) => {
      calls.push(JSON.parse(options.body));
      return calls.length === 1
        ? Response.json({ retry_after: 20 }, { status: 429 })
        : Response.json({ id: "456789012345678901" });
    }),
  );
  await sendWinnerNotifications(env, row, "lease");
  await sendWinnerNotifications(env, row, "lease");
  expect(calls).toHaveLength(1);
  clock += 20;
  await sendWinnerNotifications(env, row, "lease");
  await sendWinnerNotifications(env, row, "lease");
  expect(calls).toHaveLength(3);
  expect(calls[0].nonce).toBe(calls[1].nonce);
  expect((await campaignRow(env, row.id))!.error_code).toBeNull();
});
it("does not notify for a hidden giveaway", async () => {
  vi.stubGlobal("fetch", vi.fn());
  db.sqlite.prepare("UPDATE giveaways SET hidden=1 WHERE id=?").run(row.id);
  await sendWinnerNotifications(env, row, "lease");
  expect(fetch).not.toHaveBeenCalled();
});
