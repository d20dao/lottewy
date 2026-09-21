import {
  createPublicClient,
  http,
  verifyMessage,
  verifyTypedData,
  hashTypedData,
  type Hex,
  type Address,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import {
  actionData,
  assert,
  CHAIN_ID,
  hash,
  makeManifest,
  normalize,
  randomHex,
  type Action,
  type Draft,
  type Giveaway,
} from "../shared/core";
import { arc } from "../shared/chain";
import { review, type ReviewEnv } from "./jev";
import { quote, reconcile } from "./reconcile";
import { reserveTransaction, recordSubmission } from "./submission";
import { storeJson, loadJson } from "./storage";
import { applySeo, routeSeo, isPublicOrigin } from "../shared/seo";
import { discordInteraction, type DiscordEnv } from "./discord";
import {
  discordLinks,
  discordRoles,
  discordChannels,
  linkChallenge,
  campaignCreate,
  campaignRow,
  publicCampaign,
  recoverCampaignMessage,
  processDiscordCampaigns,
} from "./discord-campaigns";
import { normalizeDiscordCampaign } from "../shared/discord-campaign";
import { expireDiscordRegistrations } from "./discord-retention";
import { registerDiscordCommands } from "./discord-commands";
import {
  AbuseError,
  assertFunded,
  checkTurnstile,
  consumeReviewBudget,
} from "./abuse";
export type Env = ReviewEnv &
  DiscordEnv & {
    DB: D1Database;
    ASSETS: Fetcher;
    APP_ORIGIN: string;
    RPC_URL: string;
    ADMIN_ADDRESSES: string;
    CONSUMER_ADDRESS: string;
    CONSUMER_CODE_HASH?: string;
    CONSUMER_IMPLEMENTATION_ADDRESS?: string;
    CONSUMER_IMPLEMENTATION_CODE_HASH?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    AGENT_API_ORIGIN?: string;
  };
type Row = {
  id: string;
  slug: string;
  owner: string;
  revision: number;
  status: string;
  public_json: string;
  private_json: string;
  created: number;
  hidden: number;
  listed: number;
};
const now = () => Math.floor(Date.now() / 1000);
async function reviewSettings(env: Env) {
  const row = await env.DB.prepare(
    "SELECT value,revision FROM app_settings WHERE key='jev_enabled'",
  ).first<{ value: string; revision: number }>();
  assert(
    row && ["true", "false"].includes(row.value),
    "Content review settings are unavailable. Please try again.",
  );
  return { jevEnabled: row.value === "true", revision: row.revision };
}
const json = (
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      ...extra,
    },
  });
const guard = (db: D1Database) =>
  db.prepare(
    "INSERT INTO atomic_guard(ok) VALUES (CASE WHEN changes() = 1 THEN 1 ELSE 0 END)",
  );
const client = (env: Env) =>
  createPublicClient({
    chain: arc,
    transport: http(env.RPC_URL, { timeout: 15000, retryCount: 1 }),
  });
function publicRow(row: Row, viewer?: string) {
  const g = JSON.parse(row.public_json) as Giveaway;
  if (row.hidden)
    return {
      id: g.id,
      slug: g.slug,
      owner: g.owner,
      revision: g.revision,
      status: row.status,
      created: g.created,
      hidden: true,
      commitment: g.commitment,
      evidence: g.evidence,
    };
  if (g.recovery && viewer !== row.owner) {
    const { refundCredit, overpaymentCredit, ...recovery } = g.recovery;
    return { ...g, recovery, status: row.status, listed: !!row.listed };
  }
  return { ...g, status: row.status, listed: !!row.listed };
}
async function body(req: Request) {
  assert(
    req.headers.get("Content-Type")?.includes("application/json"),
    "JSON is required",
  );
  assert(
    Number(req.headers.get("Content-Length") || 0) <= 4 * 1024 * 1024,
    "Request is too large",
  );
  const reader = req.body?.getReader();
  assert(reader, "Empty request");
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Request is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function session(req: Request, env: Env) {
  const token = req.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)lottewy=([^;]+)/)?.[1];
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.address,u.suspended FROM sessions s JOIN users u ON u.address=s.address WHERE s.token=? AND s.expires>?",
  )
    .bind(hash(token), now())
    .first<{ address: Address; suspended: number }>();
}
async function signature(
  env: Env,
  address: Address,
  signed: { message: string } | ReturnType<typeof actionData>,
  sig: Hex,
) {
  assert(
    /^0x[\da-fA-F]+$/.test(sig) && sig.length <= 32770,
    "Invalid signature",
  );
  const validEOA =
    "domain" in signed
      ? await verifyTypedData({ ...signed, address, signature: sig }).catch(
          () => false,
        )
      : await verifyMessage({
          address,
          message: signed.message,
          signature: sig,
        }).catch(() => false);
  if (validEOA) return { method: "EOA", chainId: CHAIN_ID };
  const rpc = client(env);
  assert((await rpc.getChainId()) === CHAIN_ID, "Incorrect RPC network");
  const blockNumber = await rpc.getBlockNumber();
  const code = await rpc.getCode({ address, blockNumber });
  assert(
    code && code !== "0x",
    "Invalid signature or unsupported undeployed wallet",
  );
  const valid =
    "domain" in signed
      ? await rpc.verifyTypedData({
          ...signed,
          address,
          signature: sig,
          blockNumber,
        })
      : await rpc.verifyMessage({
          address,
          message: signed.message,
          signature: sig,
          blockNumber,
        });
  assert(valid, "Signature verification failed");
  return {
    method: "ERC1271",
    chainId: CHAIN_ID,
    blockNumber: blockNumber.toString(),
  };
}
export default {
  async fetch(
    req: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url),
      path = url.pathname;
    if (path === "/api/discord/interactions")
      return discordInteraction(req, env, ctx);
    if (!path.startsWith("/api/")) {
      const pageRoute =
        [
          "/",
          "/explorer",
          "/create",
          "/dashboard",
          "/history",
          "/admin",
          "/demo",
          "/discord",
        ].includes(path) ||
        ["/g/", "/agent/", "/edit/", "/demo/", "/discord/"].some((prefix) =>
          path.startsWith(prefix),
        );
      if (!pageRoute) return env.ASSETS.fetch(req);
      const meta = routeSeo(path, env.APP_ORIGIN.replace(/\/$/, ""));
      let status = 200;
      if (path === "/demo" || path.startsWith("/demo/")) status = 404;
      if (path.startsWith("/g/")) {
        const slug = path.split("/")[2];
        const row = await env.DB.prepare(
          "SELECT listed,hidden,public_json FROM giveaways WHERE id=? OR slug=?",
        )
          .bind(slug, slug)
          .first<{ listed: number; hidden: number; public_json: string }>();
        if (!row) status = 404;
        if (row?.listed && !row.hidden) {
          const g = JSON.parse(row.public_json) as Giveaway;
          meta.title = `${g.manifest.title} | Lottewy`;
          meta.description =
            "Inspect the public rules and entries, replay the recorded selection, and check the onchain evidence for this giveaway.";
          meta.indexable = isPublicOrigin(meta.origin);
          meta.path = "/g/" + encodeURIComponent(g.slug);
        }
      }
      const asset = await env.ASSETS.fetch(req);
      const headers = new Headers(asset.headers);
      headers.set(
        "X-Robots-Tag",
        meta.indexable ? "index, follow" : "noindex, nofollow",
      );
      headers.set("Cache-Control", "no-store");
      headers.delete("Content-Length");
      headers.delete("ETag");
      const html = await asset.text();
      return new Response(applySeo(html, meta), {
        status: asset.status >= 400 ? asset.status : status,
        headers,
      });
    }
    try {
      if (req.method !== "GET") {
        assert(req.headers.get("Origin") === env.APP_ORIGIN, "Origin mismatch");
        const ip = req.headers.get("CF-Connecting-IP") || "local";
        const bucket = hash([ip, Math.floor(now() / 60)]);
        const row = await env.DB.prepare(
          "INSERT INTO rate_limits(bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
        )
          .bind(bucket, now() + 120)
          .first<{ count: number }>();
        if ((row?.count || 0) > 60)
          return json(
            { error: "Too many requests. Try again in a minute." },
            429,
          );
      }
      if (path === "/api/config")
        return json({
          mode: env.MODE,
          jevMode: env.JEV_MODE,
          jevConfigured: !!env.JEV_API_KEY,
          jevEnabled: (await reviewSettings(env)).jevEnabled,
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
          agentApiOrigin: env.AGENT_API_ORIGIN || null,
          consumerVersion: 2,
          upgradeable: true,
          chainId: CHAIN_ID,
          consumer: env.CONSUMER_ADDRESS || null,
          chainReady: !!env.CONSUMER_ADDRESS && !!env.CONSUMER_CODE_HASH,
          discordConfigured:
            !!env.DISCORD_APP_ID &&
            !!env.DISCORD_APP_PUBLIC_KEY &&
            !!env.DISCORD_BOT_TOKEN,
          discordInstallUrl: env.DISCORD_APP_ID
            ? `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=84992`
            : null,
        });
      if (path === "/api/auth/challenge" && req.method === "POST") {
        const { address } = await body(req);
        assert(/^0x[\da-fA-F]{40}$/.test(address), "Invalid address");
        const nonce = crypto.randomUUID().replaceAll("-", "");
        const issued = now();
        const message = createSiweMessage({
          address,
          chainId: CHAIN_ID,
          domain: new URL(env.APP_ORIGIN).host,
          uri: env.APP_ORIGIN,
          version: "1",
          nonce,
          issuedAt: new Date(issued * 1000),
          expirationTime: new Date((issued + 300) * 1000),
          statement:
            "Sign in to Lottewy. This signature is not a payment or token approval.",
        });
        await env.DB.prepare(
          "INSERT INTO nonces(nonce,address,purpose,expires,message) VALUES (?,?,?,?,?)",
        )
          .bind(nonce, address.toLowerCase(), "login", issued + 300, message)
          .run();
        return json({ nonce, message });
      }
      if (path === "/api/auth/verify" && req.method === "POST") {
        const { nonce, signature: sig } = await body(req);
        const n = await env.DB.prepare(
          "SELECT * FROM nonces WHERE nonce=? AND purpose='login' AND consumed=0 AND expires>?",
        )
          .bind(nonce, now())
          .first<{ address: Address; message: string }>();
        assert(n, "Login challenge was used or has expired");
        await signature(env, n.address, { message: n.message }, sig);
        const token = randomHex();
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE nonces SET consumed=1 WHERE nonce=? AND consumed=0 AND expires>?",
          ).bind(nonce, now()),
          guard(env.DB),
          env.DB.prepare(
            "INSERT OR IGNORE INTO users(address,created) VALUES (?,?)",
          ).bind(n.address, now()),
          env.DB.prepare(
            "INSERT INTO sessions(token,address,expires) VALUES (?,?,?)",
          ).bind(hash(token), n.address, now() + 3600 * 12),
          env.DB.prepare("DELETE FROM atomic_guard"),
        ]);
        return json({ address: n.address }, 200, {
          "Set-Cookie": `lottewy=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`,
        });
      }
      const user = await session(req, env);
      const channelsMatch =
        /^\/api\/discord\/links\/(0x[\da-f]{64})\/channels$/i.exec(path);
      if (channelsMatch && req.method === "GET") {
        assert(user && !user.suspended, "Please sign in with an active wallet");
        return json(await discordChannels(env, user.address, channelsMatch[1]));
      }
      const rolesMatch =
        /^\/api\/discord\/links\/(0x[\da-f]{64})\/roles$/i.exec(path);
      if (rolesMatch && req.method === "GET") {
        assert(user && !user.suspended, "Please sign in with an active wallet");
        return json(await discordRoles(env, user.address, rolesMatch[1]));
      }
      if (path === "/api/discord/links" && req.method === "GET") {
        assert(user, "Please sign in with your wallet");
        return json(await discordLinks(env, user.address));
      }
      const verificationMatch =
        /^\/api\/discord\/verification\/(0x[\da-f]{64})$/i.exec(path);
      if (verificationMatch && req.method === "GET") {
        assert(user, "Please sign in with your wallet");
        const result = await env.DB.prepare(
          "SELECT consumed,message FROM nonces WHERE nonce=? AND address=? AND purpose='discord-link'",
        )
          .bind(verificationMatch[1], user.address)
          .first<{ consumed: number; message: string | null }>();
        return json({ linkId: result?.consumed ? result.message : null });
      }
      if (path === "/api/discord/challenge" && req.method === "POST") {
        assert(user && !user.suspended, "Please sign in with an active wallet");
        await body(req);
        await assertFunded(env, user.address);
        const count = await env.DB.prepare(
          "INSERT INTO rate_limits(bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
        )
          .bind(
            "discord-link:" + hash([user.address, Math.floor(now() / 60)]),
            now() + 120,
          )
          .first<{ count: number }>();
        assert(
          count && count.count <= 5,
          "Too many verification codes. Try again shortly.",
        );
        return json(await linkChallenge(env, user.address));
      }
      if (path === "/api/discord/campaigns" && req.method === "GET") {
        assert(user, "Please sign in with your wallet");
        const rows = await env.DB.prepare(
          "SELECT * FROM discord_campaigns WHERE owner=? AND (status<>'expired' OR (message_id IS NULL AND publish_started_at IS NOT NULL)) ORDER BY created DESC LIMIT 50",
        )
          .bind(user.address)
          .all();
        return json(rows.results.map((r: any) => publicCampaign(r)));
      }
      const campaignMatch = /^\/api\/discord\/campaigns\/([\da-f-]{36})$/i.exec(
        path,
      );
      if (campaignMatch && req.method === "GET") {
        const row = await campaignRow(env, campaignMatch[1].toLowerCase());
        if (!row)
          return json({ error: "Giveaway registration not found" }, 404);
        const moderation = await env.DB.prepare(
          "SELECT hidden FROM giveaways WHERE id=?",
        )
          .bind(row.id)
          .first<{ hidden: number }>();
        if (moderation?.hidden)
          return json({ id: row.id, owner: row.owner, status: "hidden" });
        if (
          ctx &&
          (row.status === "publishing" ||
            row.status === "closing" ||
            (row.status === "open" && row.ends_at <= now()))
        )
          ctx.waitUntil(processDiscordCampaigns(env));
        return json({ ...publicCampaign(row), serverTime: now() });
      }
      if (path === "/api/submission-hint" && req.method === "POST") {
        assert(user, "Please sign in with your wallet");
        const input = await body(req);
        return json(
          await recordSubmission(
            env,
            user.address,
            input.id,
            input.txHash,
            input.kind,
          ),
        );
      }
      const admin =
        !!user &&
        env.ADMIN_ADDRESSES.toLowerCase()
          .split(",")
          .map((s) => s.trim())
          .includes(user.address);
      if (path === "/api/auth/me")
        return json(user ? { ...user, admin } : null);
      if (path === "/api/auth/logout" && req.method === "POST") {
        const token = req.headers
          .get("Cookie")
          ?.match(/(?:^|;\s*)lottewy=([^;]+)/)?.[1];
        if (token)
          await env.DB.prepare("DELETE FROM sessions WHERE token=?")
            .bind(hash(token))
            .run();
        return json({ ok: true }, 200, {
          "Set-Cookie":
            "lottewy=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        });
      }
      if (path === "/api/giveaways" && req.method === "GET") {
        const mine = url.searchParams.get("mine") === "1";
        if (mine) assert(user, "Please sign in with your wallet");
        const conditions: string[] = [],
          values: (string | number)[] = [];
        if (!mine) conditions.push("listed=1 AND hidden=0");
        if (mine) {
          conditions.push("owner=?");
          values.push(user!.address);
        }
        const query = (url.searchParams.get("q") || "").slice(0, 120),
          status = url.searchParams.get("status"),
          date = url.searchParams.get("date");
        if (query) {
          conditions.push(
            "((hidden=0 AND instr(lower(json_extract(public_json,'$.manifest.title')),lower(?))>0) OR instr(lower(owner),lower(?))>0 OR instr(lower(id),lower(?))>0)",
          );
          values.push(query, query, query);
        }
        if (status) {
          conditions.push("status=?");
          values.push(status);
        }
        if (date) {
          const since = Date.parse(`${date}T00:00:00Z`) / 1000;
          assert(Number.isFinite(since), "Invalid date");
          conditions.push("created>=? AND created<?");
          values.push(since, since + 86400);
        }
        const offset = Number(url.searchParams.get("offset") || 0);
        const pageSize = Number(url.searchParams.get("limit") || 50);
        assert([10, 20, 50].includes(pageSize), "Invalid page size");
        assert(
          Number.isInteger(offset) && offset >= 0 && offset <= 1000000,
          "Invalid page",
        );
        if (url.searchParams.get("paged") === "1") {
          const [count, summaries] = await Promise.all([
            env.DB.prepare(
              `SELECT COUNT(*) AS total FROM giveaways ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""}`,
            )
              .bind(...values)
              .first<{ total: number }>(),
            env.DB.prepare(
              `SELECT id,slug,owner,revision,status,created,hidden,listed,json_extract(public_json,'$.manifest.title') AS title,json_array_length(public_json,'$.manifest.entries') AS entry_count FROM giveaways ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?`,
            )
              .bind(...values, pageSize, offset)
              .all<{
                id: string;
                slug: string;
                owner: string;
                revision: number;
                status: string;
                created: number;
                hidden: number;
                listed: number;
                title: string;
                entry_count: number;
              }>(),
          ]);
          return json({
            items: summaries.results.map((r) => ({
              id: r.id,
              slug: r.slug,
              owner: r.owner,
              revision: r.revision,
              status: r.status,
              created: r.created,
              hidden: !!r.hidden,
              listed: !!r.listed,
              ...(!r.hidden
                ? { manifest: { title: r.title }, entryCount: r.entry_count }
                : {}),
            })),
            total: count?.total || 0,
            pageSize,
            offset,
          });
        }
        const rows = await env.DB.prepare(
          `SELECT * FROM giveaways ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY created DESC,id DESC LIMIT ? OFFSET ?`,
        )
          .bind(...values, pageSize, offset)
          .all<Row>();
        return json(rows.results.map((row) => publicRow(row)));
      }
      if (
        path.startsWith("/api/giveaways/") &&
        (req.method === "GET" ||
          (req.method === "POST" && path.endsWith("/sync")))
      ) {
        const slug = path.split("/")[3],
          isPrivate = path.endsWith("/private");
        let row = await env.DB.prepare(
          "SELECT * FROM giveaways WHERE slug=? OR id=?",
        )
          .bind(slug, slug)
          .first<Row>();
        if (!row) return json({ error: "Giveaway not found" }, 404);
        if (req.method === "POST") {
          await body(req);
          const state = [
            "submitting",
            "pending",
            "waiting",
            "callback",
            "refund_due",
            "reconciliation",
          ].includes(row.status)
            ? await reconcile(env, { giveawayId: row.id })
            : "unchanged";
          if (state === "unavailable")
            return json(
              {
                error:
                  "Chain synchronization is temporarily unavailable. The saved giveaway is unchanged.",
              },
              503,
            );
          row = (await env.DB.prepare("SELECT * FROM giveaways WHERE id=?")
            .bind(row.id)
            .first<Row>())!;
          if (ctx && (JSON.parse(row.public_json) as Giveaway).registration)
            ctx.waitUntil(processDiscordCampaigns(env));
        }
        if (isPrivate) {
          assert(
            user?.address === row.owner,
            "You do not have permission to access this list",
          );
          return json({
            ...JSON.parse(row.public_json),
            private: await loadJson(env.DB, row.private_json),
            status: row.status,
            listed: !!row.listed,
          });
        }
        const revisions = await env.DB.prepare(
          "SELECT revision,public_json FROM revisions WHERE giveaway_id=? ORDER BY revision",
        )
          .bind(row.id)
          .all<{ revision: number; public_json: string }>();
        const attempts = await env.DB.prepare(
          "SELECT outcome,tx_hash,observed FROM attempt_history WHERE giveaway_id=? ORDER BY id",
        )
          .bind(row.id)
          .all();
        return json({
          ...publicRow(row, user?.address),
          attempts: attempts.results,
          history: revisions.results.map((r) => ({
            revision: r.revision,
            commitment: (JSON.parse(r.public_json) as Giveaway).commitment,
          })),
        });
      }
      if (path === "/api/quote" && req.method === "GET") {
        assert(user, "Please sign in with your wallet");
        return json(await quote(env));
      }
      if (path === "/api/actions/challenge" && req.method === "POST") {
        assert(user, "Please sign in with your wallet");
        const input = await body(req);
        if (["create", "edit", "discordCreate"].includes(input.actionType))
          await assertFunded(env, user.address);
        const nonce = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO nonces(nonce,address,purpose,expires) VALUES (?,?,?,?)",
        )
          .bind(nonce, user.address, "action", now() + 300)
          .run();
        return json({
          nonce,
          issuedAt: now(),
          expiresAt: now() + 300,
          audience: env.APP_ORIGIN,
        });
      }
      if (path === "/api/admin" && req.method === "GET") {
        assert(admin, "Admin permission required");
        const [members, reports, giveaways, actions, settings] =
          await Promise.all([
            env.DB.prepare(
              "SELECT * FROM users ORDER BY created DESC LIMIT 200",
            ).all(),
            env.DB.prepare(
              "SELECT * FROM reports ORDER BY created DESC LIMIT 200",
            ).all(),
            env.DB.prepare(
              "SELECT * FROM giveaways ORDER BY created DESC LIMIT 200",
            ).all<Row>(),
            env.DB.prepare(
              "SELECT action_id,signer,action_type,target,accepted,result_revision FROM actions ORDER BY accepted DESC LIMIT 200",
            ).all(),
            reviewSettings(env),
          ]);
        return json({
          members: members.results,
          reports: reports.results,
          giveaways: giveaways.results.map((row) => publicRow(row)),
          actions: actions.results,
          settings,
        });
      }
      if (path === "/api/history" && req.method === "GET") {
        assert(user, "Please sign in with your wallet");
        const actions = await env.DB.prepare(
          "SELECT action_id,action_type,target,accepted,result_revision FROM actions WHERE signer=? ORDER BY accepted DESC LIMIT 200",
        )
          .bind(user.address)
          .all();
        return json(actions.results);
      }
      if (path === "/api/actions" && req.method === "POST") {
        assert(user, "Please sign in with your wallet");
        const {
          action,
          payload,
          signature: sig,
          turnstileToken,
        } = (await body(req)) as {
          action: Action;
          payload: any;
          signature: Hex;
          turnstileToken?: string;
        };
        assert(
          action &&
            action.signer?.toLowerCase() === user.address &&
            action.audience === env.APP_ORIGIN &&
            Number.isInteger(action.expectedRevision),
          "Action context mismatch",
        );
        assert(
          /^[a-f\d-]{36}$/i.test(action.actionId) &&
            /^[a-f\d-]{36}$/i.test(action.nonce),
          "Invalid action identifier",
        );
        assert(
          action.payloadHash === hash(payload),
          "The signed payload has changed",
        );
        const signed = actionData(action),
          digest = hashTypedData(signed);
        const prior = await env.DB.prepare(
          "SELECT digest,result_json FROM actions WHERE action_id=?",
        )
          .bind(action.actionId)
          .first<{ digest: string; result_json: string }>();
        if (prior) {
          assert(
            prior.digest === digest,
            "Action ID already used with a different payload",
          );
          return json(JSON.parse(prior.result_json));
        }
        assert(
          action.issuedAt <= now() + 15 &&
            action.expiresAt > now() &&
            action.expiresAt - action.issuedAt <= 300,
          "Action has expired",
        );
        const nonce = await env.DB.prepare(
          "SELECT nonce FROM nonces WHERE nonce=? AND address=? AND purpose='action' AND consumed=0 AND expires>=?",
        )
          .bind(action.nonce, user.address, action.expiresAt)
          .first();
        assert(nonce, "Nonce is used or invalid");
        const verification = await signature(env, user.address, signed, sig);
        const statements: D1PreparedStatement[] = [];
        let result: unknown = { ok: true };
        let resultRevision = action.expectedRevision;
        const row = await env.DB.prepare("SELECT * FROM giveaways WHERE id=?")
          .bind(action.giveawayId)
          .first<Row>();
        if (action.actionType === "discordCreate") {
          assert(
            !user.suspended && !row && action.expectedRevision === 0,
            "This wallet cannot create this Discord giveaway",
          );
          const d = normalizeDiscordCampaign(payload);
          assert(
            hash(d) === action.payloadHash,
            "Normalize the campaign details before signing",
          );
          await assertFunded(env, user.address);
          await checkTurnstile(
            env,
            turnstileToken,
            req.headers.get("CF-Connecting-IP") || undefined,
          );
          await consumeReviewBudget(env, user.address);
          const settings = await reviewSettings(env),
            evaluation = await review({ ...d, entries: [] }, env, settings);
          const prepared = await campaignCreate(
            env,
            user.address,
            action.giveawayId,
            d,
            evaluation,
          );
          statements.push(
            env.DB.prepare(
              "INSERT INTO atomic_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM app_settings WHERE key='jev_enabled' AND revision=?) THEN 1 ELSE 0 END",
            ).bind(settings.revision),
            ...prepared.statements,
          );
          result = prepared.result;
          resultRevision = 1;
        } else if (action.actionType === "discordRecover") {
          assert(
            !user.suspended && action.expectedRevision === 1,
            "This recovery action is unavailable",
          );
          const campaign = await campaignRow(env, action.giveawayId);
          assert(campaign?.owner === user.address, "Organizer access required");
          statements.push(
            ...(await recoverCampaignMessage(
              env,
              user.address,
              action.giveawayId,
              String(payload.messageId || ""),
            )),
          );
          result = {
            ...publicCampaign(campaign),
            status:
              campaign.status === "publishing_uncertain"
                ? "open"
                : campaign.status,
            errorCode: null,
          };
        } else if (action.actionType === "discordCancel") {
          const campaign = await campaignRow(env, action.giveawayId);
          assert(
            campaign?.owner === user.address &&
              action.expectedRevision === 1 &&
              [
                "publishing",
                "publishing_uncertain",
                "open",
                "insufficient",
              ].includes(campaign.status),
            "This registration cannot be cancelled",
          );
          statements.push(
            env.DB.prepare(
              "UPDATE discord_campaigns SET status='cancelled',closed_at=COALESCE(closed_at,unixepoch()),error_code=NULL WHERE id=? AND owner=? AND status IN ('publishing','publishing_uncertain','open','insufficient')",
            ).bind(campaign.id, user.address),
            guard(env.DB),
          );
          result = { ...publicCampaign(campaign), status: "cancelled" };
        } else if (
          action.actionType === "create" ||
          action.actionType === "edit"
        ) {
          assert(
            !user.suspended,
            "This account cannot create or edit giveaways while suspended",
          );
          assert(
            action.actionType === "create"
              ? !row && action.expectedRevision === 0
              : row?.owner === user.address &&
                  row.status === "draft" &&
                  row.revision === action.expectedRevision,
            "Ownership, revision or lock mismatch",
          );
          assert(
            /^[a-f\d-]{36}$/.test(action.giveawayId),
            "Invalid giveaway ID",
          );
          assert(
            !row || !(JSON.parse(row.public_json) as Giveaway).registration,
            "Discord registration is closed. Its participant list and rules cannot be edited.",
          );
          if (!row) {
            const reserved = await env.DB.prepare(
              "SELECT id FROM discord_campaigns WHERE id=?",
            )
              .bind(action.giveawayId)
              .first();
            assert(!reserved, "This ID belongs to a Discord registration");
            statements.push(
              env.DB.prepare(
                "INSERT INTO atomic_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM discord_campaigns WHERE id=?) THEN 1 ELSE 0 END",
              ).bind(action.giveawayId),
            );
          }
          const d = normalize(payload as Draft);
          assert(
            hash(d) === action.payloadHash,
            "Normalize the list before signing",
          );
          await assertFunded(env, user.address);
          await checkTurnstile(
            env,
            turnstileToken,
            req.headers.get("CF-Connecting-IP") || undefined,
          );
          await consumeReviewBudget(env, user.address);
          const settings = await reviewSettings(env);
          const evaluation = await review(d, env, settings);
          statements.push(
            env.DB.prepare(
              "INSERT INTO atomic_guard(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM app_settings WHERE key='jev_enabled' AND revision=?) THEN 1 ELSE 0 END",
            ).bind(settings.revision),
          );
          resultRevision++;
          const built = makeManifest(
            d,
            action.giveawayId,
            user.address,
            resultRevision,
          );
          const g: Giveaway = {
            id: action.giveawayId,
            slug: row?.slug || action.giveawayId,
            owner: user.address,
            revision: resultRevision,
            status: "draft",
            listed: d.listed ?? !!row?.listed,
            manifest: built.manifest,
            commitment: built.commitment,
            created: row?.created || now(),
            review: {
              mode: evaluation.mode,
              model: evaluation.model,
              policy: evaluation.policy,
            },
          };
          const pub = JSON.stringify(g);
          assert(
            new TextEncoder().encode(pub).length < 1800000,
            "The public manifest is too large",
          );
          const stored = storeJson(env.DB, `private:${g.id}:${g.revision}`, {
              draft: d,
              entries: built.privateEntries,
            }),
            priv = stored.reference;
          statements.push(...stored.statements);
          if (!row)
            statements.push(
              env.DB.prepare(
                "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created,listed) VALUES (?,?,?,?,?,?,?,?,?)",
              ).bind(
                g.id,
                g.slug,
                g.owner,
                g.revision,
                g.status,
                pub,
                priv,
                g.created,
                Number(g.listed),
              ),
            );
          else
            statements.push(
              env.DB.prepare(
                "UPDATE giveaways SET revision=?,public_json=?,private_json=?,listed=? WHERE id=? AND owner=? AND revision=? AND status='draft'",
              ).bind(
                g.revision,
                pub,
                priv,
                Number(g.listed),
                g.id,
                g.owner,
                action.expectedRevision,
              ),
              guard(env.DB),
            );
          statements.push(
            env.DB.prepare(
              "INSERT INTO revisions(giveaway_id,revision,public_json,private_json,review_json) VALUES (?,?,?,?,?)",
            ).bind(g.id, g.revision, pub, priv, JSON.stringify(evaluation)),
          );
          result = g;
        } else if (action.actionType === "start") {
          assert(
            !user.suspended &&
              row?.owner === user.address &&
              row.status === "draft" &&
              row.revision === action.expectedRevision,
            "Ownership, revision or lock mismatch",
          );
          const g = JSON.parse(row.public_json) as Giveaway;
          assert(
            ["live", "local"].includes(g.review.mode),
            "Development-only records cannot start an onchain draw",
          );
          assert(payload.commitment === g.commitment, "Commitment mismatch");
          const pending = await env.DB.prepare(
            "SELECT a.giveaway_id FROM attempts a JOIN giveaways g ON g.id=a.giveaway_id WHERE g.owner=? AND a.state IN ('submitting','pending') LIMIT 1",
          )
            .bind(user.address)
            .first();
          assert(
            !pending,
            "This wallet already has an unconfirmed draw. Resolve it before starting another.",
          );
          const pricing = await quote(env);
          const reservation = await reserveTransaction(env, user.address);
          statements.push(
            env.DB.prepare(
              "INSERT INTO atomic_guard(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM attempts a JOIN giveaways g ON g.id=a.giveaway_id WHERE g.owner=? AND a.state IN ('submitting','pending')) THEN 1 ELSE 0 END",
            ).bind(user.address),
            env.DB.prepare(
              "UPDATE giveaways SET status='submitting' WHERE id=? AND revision=? AND status='draft'",
            ).bind(row.id, row.revision),
            guard(env.DB),
          );
          statements.push(
            env.DB.prepare(
              "INSERT INTO attempts(giveaway_id,commitment,reserved,start_block,state,sender_nonce,consumer,attempt_id) VALUES (?,?,?,?,?,?,?,?)",
            ).bind(
              row.id,
              g.commitment,
              now(),
              pricing.blockNumber,
              "submitting",
              reservation.nonce,
              reservation.consumer,
              action.actionId,
            ),
          );
          const reserved = { ...g, status: "submitting", reservation };
          statements.push(
            env.DB.prepare(
              "UPDATE giveaways SET public_json=? WHERE id=?",
            ).bind(JSON.stringify(reserved), g.id),
          );
          result = reserved;
        } else if (action.actionType === "register-discord-commands") {
          assert(
            admin &&
              !user.suspended &&
              action.giveawayId === "discord_commands" &&
              action.expectedRevision === 0 &&
              payload.confirm === true,
            "Admin permission and explicit Discord registration confirmation are required",
          );
          result = await registerDiscordCommands(env);
        } else if (action.actionType === "set-jev") {
          assert(
            admin &&
              action.giveawayId === "jev_enabled" &&
              typeof payload.enabled === "boolean" &&
              typeof payload.reason === "string" &&
              payload.reason.trim().length >= 10 &&
              payload.reason.length <= 1000,
            "Admin permission and a review note are required",
          );
          resultRevision = action.expectedRevision + 1;
          statements.push(
            env.DB.prepare(
              "UPDATE app_settings SET value=?,revision=revision+1 WHERE key='jev_enabled' AND revision=?",
            ).bind(String(payload.enabled), action.expectedRevision),
            guard(env.DB),
          );
          result = { jevEnabled: payload.enabled, revision: resultRevision };
        } else if (action.actionType === "submitted") {
          throw new Error(
            "Use the authenticated transaction submission endpoint.",
          );
        } else if (action.actionType === "report") {
          assert(
            row &&
              typeof payload.reason === "string" &&
              payload.reason.trim().length >= 10 &&
              payload.reason.length <= 1000,
            "A report must contain at least 10 characters",
          );
          statements.push(
            env.DB.prepare(
              "INSERT INTO reports(id,giveaway_id,reporter,reason,state,created) VALUES (?,?,?,?,?,?)",
            ).bind(
              action.actionId,
              row.id,
              user.address,
              payload.reason,
              "new",
              now(),
            ),
          );
        } else if (
          ["moderate", "suspend", "resolve-report"].includes(action.actionType)
        ) {
          assert(
            admin &&
              typeof payload.reason === "string" &&
              payload.reason.trim().length >= 10 &&
              payload.reason.length <= 1000,
            "Admin permission and a reason are required",
          );
          if (action.actionType === "moderate") {
            assert(
              row && typeof payload.hidden === "boolean",
              "Record not found",
            );
            statements.push(
              env.DB.prepare("UPDATE giveaways SET hidden=? WHERE id=?").bind(
                Number(payload.hidden),
                row.id,
              ),
              guard(env.DB),
            );
          }
          if (action.actionType === "suspend") {
            assert(typeof payload.suspended === "boolean", "Invalid status");
            statements.push(
              env.DB.prepare(
                "UPDATE users SET suspended=? WHERE address=?",
              ).bind(
                Number(payload.suspended),
                action.giveawayId.toLowerCase(),
              ),
              guard(env.DB),
            );
          }
          if (action.actionType === "resolve-report")
            statements.push(
              env.DB.prepare(
                "UPDATE reports SET state='resolved',note=? WHERE id=? AND state<>'resolved'",
              ).bind(payload.reason, action.giveawayId),
              guard(env.DB),
            );
        } else throw new Error("Unsupported action");
        const storedPayload = storeJson(
          env.DB,
          `action:${action.actionId}:payload`,
          payload,
        );
        // D1 batch + constraint guards atomically couple mutation, chunks, nonce and journal.
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE nonces SET consumed=1 WHERE nonce=? AND address=? AND consumed=0 AND expires>?",
          ).bind(action.nonce, user.address, now()),
          guard(env.DB),
          ...statements,
          ...storedPayload.statements,
          env.DB.prepare(
            "INSERT INTO actions(action_id,digest,signer,action_type,target,expected_revision,result_revision,payload_json,signed_json,signature,verification_json,accepted,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).bind(
            action.actionId,
            digest,
            user.address,
            action.actionType,
            action.giveawayId,
            action.expectedRevision,
            resultRevision,
            storedPayload.reference,
            JSON.stringify(signed),
            sig,
            JSON.stringify(verification),
            now(),
            JSON.stringify(result),
          ),
          env.DB.prepare("DELETE FROM atomic_guard"),
        ]);
        if (
          ctx &&
          (action.actionType.startsWith("discord") ||
            (row && (JSON.parse(row.public_json) as Giveaway).registration))
        )
          ctx.waitUntil(processDiscordCampaigns(env));
        return json(result);
      }
      return json({ error: "Endpoint not found" }, 404);
    } catch (error) {
      if (env.MODE === "development")
        console.warn(
          "API request failed",
          error instanceof Error ? error.name : "Unknown",
          error instanceof Error
            ? error.stack
                ?.split("\n")
                .filter((line) => line.trim().startsWith("at "))
                .slice(0, 2)
            : [],
        );
      const message = error instanceof Error ? error.message : "";
      // Never return upstream responses, SQL, signed private payloads, or secret-bearing errors.
      const safe =
        /D1_|SQLITE|constraint|fetch|HTTP|RPC|0x[\da-fA-F]{64}/i.test(message)
          ? "The action failed or the revision changed. Refresh and check the current state."
          : message;
      if (error instanceof AbuseError)
        return json({ error: error.message, code: error.code }, error.status);
      const code = (error as { code?: string })?.code;
      const publicCode =
        code &&
        [
          "ARC_USDC_REQUIRED",
          "CONTENT_REVIEW_REJECTED",
          "REVIEW_RATE_LIMIT",
          "BOT_CHECK_REQUIRED",
        ].includes(code)
          ? code
          : undefined;
      return json(
        {
          error: safe || "The action could not be completed",
          ...(publicCode ? { code: publicCode } : {}),
        },
        publicCode === "REVIEW_RATE_LIMIT" ? 429 : 400,
      );
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        try {
          await reconcile(env);
        } finally {
          await expireDiscordRegistrations(env);
          await processDiscordCampaigns(env);
        }
      })(),
    );
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE expires<?").bind(now()),
        env.DB.prepare("DELETE FROM nonces WHERE expires<?").bind(
          now() - 86400,
        ),
        env.DB.prepare("DELETE FROM rate_limits WHERE expires<?").bind(now()),
        env.DB.prepare("DELETE FROM abuse_buckets WHERE expires<=?").bind(
          now(),
        ),
        env.DB.prepare(
          "DELETE FROM discord_interactions WHERE expires<=?",
        ).bind(now()),
      ]).then(() => {}),
    );
  },
};
