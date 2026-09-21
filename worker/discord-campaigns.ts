import { hash, makeManifest, normalize, type Giveaway } from "../shared/core";
import {
  normalizeDiscordCampaign,
  type DiscordCampaignInput,
} from "../shared/discord-campaign";
import { storeJson } from "./storage";
import { discordMentions, discordText } from "./discord-format";
import type { DiscordEnv } from "./discord";
import { campaignResultMessage } from "./discord-result-message";
export type CampaignEnv = DiscordEnv & { DISCORD_BOT_TOKEN?: string };
export class DiscordCampaignError extends Error {}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DiscordCampaignError(message);
}
export type Campaign = {
  id: string;
  owner: string;
  revision: number;
  status: string;
  input_json: string;
  payload_hash: string;
  guild_id: string;
  channel_id: string;
  ends_at: number;
  created: number;
  participant_count: number;
  message_id: string | null;
  message_state: string | null;
  publish_started_at: number | null;
  closed_at: number | null;
  review_json: string;
  error_code: string | null;
  lease_token: string | null;
  lease_until: number;
};
type Link = {
  id: string;
  owner: string;
  guild_id: string;
  channel_id: string;
  verifier_id: string;
  guild_name: string;
  channel_name: string;
  verified_at: number;
};
const snowflake = /^\d{17,20}$/;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const guard = (db: D1Database) =>
  db.prepare(
    "INSERT INTO atomic_guard(ok) VALUES(CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
  );
export async function discordApi(
  env: CampaignEnv,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  assert(env.DISCORD_BOT_TOKEN, "Discord bot configuration is unavailable");
  try {
    const response = await fetch("https://discord.com/api/v10" + path, {
      method,
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    if (response.status === 204) return null;
    return await response.json();
  } catch {
    throw new DiscordCampaignError(
      "Discord could not complete this request. Check the bot permissions or try again later.",
    );
  }
}
async function botIdentity(env: CampaignEnv) {
  const app = await discordApi(env, "/oauth2/applications/@me");
  assert(
    app.id === env.DISCORD_APP_ID &&
      app.verify_key?.toLowerCase() ===
        env.DISCORD_APP_PUBLIC_KEY?.toLowerCase(),
    "Discord bot credentials do not match this application",
  );
  const id = app.bot?.id || (await discordApi(env, "/users/@me")).id;
  assert(snowflake.test(id), "Discord bot identity is unavailable");
  return id as string;
}
export async function discordLinks(env: CampaignEnv, owner: string) {
  const rows = await env.DB.prepare(
    "SELECT * FROM discord_links WHERE owner=? ORDER BY verified_at DESC LIMIT 50",
  )
    .bind(owner)
    .all<Link>();
  return rows.results.map(
    ({ id, guild_id, guild_name, channel_name, verified_at }) => ({
      id,
      guildId: guild_id,
      guildName: guild_name,
      channelName: channel_name,
      verifiedAt: verified_at,
    }),
  );
}
export async function discordRoles(
  env: CampaignEnv,
  owner: string,
  linkId: string,
) {
  const link = await env.DB.prepare(
    "SELECT guild_id,verifier_id FROM discord_links WHERE id=? AND owner=?",
  )
    .bind(linkId, owner)
    .first<{ guild_id: string; verifier_id: string }>();
  assert(link, "Verify this server channel first");
  const guild = await discordApi(env, "/guilds/" + link.guild_id);
  const member = await discordApi(
      env,
      `/guilds/${link.guild_id}/members/${link.verifier_id}`,
    ),
    memberRoles = new Set([link.guild_id, ...(member.roles || [])]),
    permissions = (guild.roles || [])
      .filter((r: any) => memberRoles.has(r.id))
      .reduce((sum: bigint, r: any) => sum | BigInt(r.permissions || "0"), 0n);
  assert(
    guild.owner_id === link.verifier_id || (permissions & 40n) !== 0n,
    "Verify the server again with Manage Server permission",
  );
  return (Array.isArray(guild.roles) ? guild.roles : [])
    .filter((r: any) => snowflake.test(r.id) && r.id !== link.guild_id)
    .map((r: any) => ({
      id: String(r.id),
      name: String(r.name).slice(0, 100),
    })) as { id: string; name: string }[];
}
export function canPostInChannel(
  guild: any,
  member: any,
  botId: string,
  channel: any,
) {
  if (![0, 5].includes(channel.type) || channel.guild_id !== guild.id)
    return false;
  const roles = new Set(member.roles || []);
  let permissions = BigInt(0);
  for (const role of guild.roles || [])
    if (role.id === guild.id || roles.has(role.id))
      permissions |= BigInt(role.permissions || "0");
  if (guild.owner_id === botId || (permissions & 8n) !== 0n) return true;
  const overwrites = channel.permission_overwrites || [],
    everyone = overwrites.find((o: any) => o.type === 0 && o.id === guild.id);
  if (everyone)
    permissions =
      (permissions & ~BigInt(everyone.deny || "0")) |
      BigInt(everyone.allow || "0");
  let deny = 0n,
    allow = 0n;
  for (const o of overwrites)
    if (o.type === 0 && o.id !== guild.id && roles.has(o.id)) {
      deny |= BigInt(o.deny || "0");
      allow |= BigInt(o.allow || "0");
    }
  permissions = (permissions & ~deny) | allow;
  const own = overwrites.find((o: any) => o.type === 1 && o.id === botId);
  if (own)
    permissions =
      (permissions & ~BigInt(own.deny || "0")) | BigInt(own.allow || "0");
  return (permissions & 84992n) === 84992n;
}
export async function discordChannels(
  env: CampaignEnv,
  owner: string,
  linkId: string,
) {
  const link = await env.DB.prepare(
    "SELECT * FROM discord_links WHERE id=? AND owner=?",
  )
    .bind(linkId, owner)
    .first<Link>();
  assert(link, "Verify your server first");
  const botId = await botIdentity(env);
  const [guild, member, verifier, channels] = await Promise.all([
    discordApi(env, "/guilds/" + link.guild_id),
    discordApi(env, `/guilds/${link.guild_id}/members/${botId}`),
    discordApi(env, `/guilds/${link.guild_id}/members/${link.verifier_id}`),
    discordApi(env, `/guilds/${link.guild_id}/channels`),
  ]);
  const roles = new Set([link.guild_id, ...(verifier.roles || [])]),
    permissions = (guild.roles || [])
      .filter((r: any) => roles.has(r.id))
      .reduce((p: bigint, r: any) => p | BigInt(r.permissions || "0"), 0n);
  assert(
    guild.owner_id === link.verifier_id || (permissions & 40n) !== 0n,
    "Verify the server again with Manage Server permission",
  );
  return channels
    .filter((c: any) => canPostInChannel(guild, member, botId, c))
    .sort((a: any, b: any) => a.position - b.position)
    .map((c: any) => ({ id: String(c.id), name: String(c.name) }));
}
export async function linkChallenge(env: CampaignEnv, owner: string) {
  assert(
    env.DISCORD_APP_ID && env.DISCORD_APP_PUBLIC_KEY && env.DISCORD_BOT_TOKEN,
    "Discord participation is not configured",
  );
  const code = crypto.randomUUID(),
    expires = Math.floor(Date.now() / 1000) + 600;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM nonces WHERE address=? AND purpose='discord-link' AND consumed=0",
    ).bind(owner),
    env.DB.prepare(
      "INSERT INTO nonces(nonce,address,purpose,expires) VALUES (?,?,'discord-link',?)",
    ).bind(hash(code), owner, expires),
  ]);
  return {
    code,
    nonceRef: hash(code),
    expires,
    installUrl: `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=84992`,
  };
}
export async function verifyChannel(
  env: CampaignEnv,
  interaction: any,
  code: unknown,
) {
  assert(
    typeof code === "string" && uuid.test(code.trim()),
    "Use the verification code shown on Lottewy",
  );
  const permissions = BigInt(
    /^\d+$/.test(interaction.member?.permissions || "")
      ? interaction.member.permissions
      : "0",
  );
  assert(
    (permissions & 32n) !== 0n || (permissions & 8n) !== 0n,
    "Manage Server permission is required to verify this channel",
  );
  assert(
    snowflake.test(interaction.guild_id || "") &&
      snowflake.test(interaction.channel_id || "") &&
      snowflake.test(interaction.member?.user?.id || ""),
    "Use this command in the intended server channel",
  );
  const nonce = await env.DB.prepare(
    "SELECT address FROM nonces WHERE nonce=? AND purpose='discord-link' AND consumed=0 AND expires>unixepoch()",
  )
    .bind(hash(code.trim().toLowerCase()))
    .first<{ address: string }>();
  assert(nonce, "This verification code expired or was already used");
  await botIdentity(env);
  const guild = await discordApi(env, "/guilds/" + interaction.guild_id);
  const id = hash([nonce.address, interaction.guild_id]);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE nonces SET consumed=1,message=? WHERE nonce=? AND purpose='discord-link' AND consumed=0 AND expires>unixepoch()",
    ).bind(id, hash(code.trim().toLowerCase())),
    guard(env.DB),
    env.DB.prepare(
      `INSERT INTO discord_links(id,owner,guild_id,channel_id,verifier_id,guild_name,channel_name,verified_at) VALUES(?,?,?,?,?,?,?,unixepoch())
    ON CONFLICT(id) DO UPDATE SET verifier_id=excluded.verifier_id,guild_name=excluded.guild_name,channel_id=excluded.channel_id,channel_name=excluded.channel_name,verified_at=excluded.verified_at`,
    ).bind(
      id,
      nonce.address,
      interaction.guild_id,
      interaction.channel_id,
      interaction.member.user.id,
      String(guild.name).slice(0, 100),
      "",
    ),
    env.DB.prepare("DELETE FROM atomic_guard"),
  ]);
  return `This server is verified for wallet ${nonce.address.slice(0, 6)}…${nonce.address.slice(-4)}. Return to Lottewy to choose the giveaway channel and roles.`;
}
async function currentLinkAccess(
  env: CampaignEnv,
  owner: string,
  linkId: string,
  requiredRoles: string[] = [],
  channelId?: string,
) {
  const link = await env.DB.prepare(
    "SELECT * FROM discord_links WHERE id=? AND owner=?",
  )
    .bind(linkId, owner)
    .first<Link>();
  assert(link, "Verify the intended Discord server channel first");
  const botId = await botIdentity(env);
  const [guild, member, channel] = await Promise.all([
    discordApi(env, "/guilds/" + link.guild_id),
    discordApi(env, `/guilds/${link.guild_id}/members/${link.verifier_id}`),
    discordApi(env, "/channels/" + (channelId || link.channel_id)),
  ]);
  assert(
    channel.guild_id === link.guild_id && [0, 5].includes(channel.type),
    "The verified channel is no longer available",
  );
  const roles = new Set([
    link.guild_id,
    ...(Array.isArray(member.roles) ? member.roles : []),
  ]);
  const permissions = (Array.isArray(guild.roles) ? guild.roles : [])
    .filter((r: any) => roles.has(r.id))
    .reduce((sum: bigint, r: any) => sum | BigInt(r.permissions || "0"), 0n);
  assert(
    guild.owner_id === link.verifier_id ||
      (permissions & 32n) !== 0n ||
      (permissions & 8n) !== 0n,
    "The verifier no longer has Manage Server permission. Verify the channel again.",
  );
  assert(
    requiredRoles.every(
      (id) =>
        id !== link.guild_id &&
        Array.isArray(guild.roles) &&
        guild.roles.some((r: any) => r.id === id),
    ),
    "A selected role is no longer available in this server",
  );
  const botMember = await discordApi(
    env,
    `/guilds/${link.guild_id}/members/${botId}`,
  );
  assert(
    canPostInChannel(guild, botMember, botId, channel),
    "The bot cannot post in this channel. Allow View Channel, Send Messages, Embed Links and Read Message History.",
  );
  return { ...link, channel_id: channelId || link.channel_id };
}
export async function campaignCreate(
  env: CampaignEnv,
  owner: string,
  id: string,
  input: DiscordCampaignInput,
  review: unknown,
) {
  const d = normalizeDiscordCampaign(input);
  assert(uuid.test(id) && id === id.toLowerCase(), "Invalid giveaway ID");
  const now = Math.floor(Date.now() / 1000);
  assert(
    d.endsAt >= now + 120 && d.endsAt <= now + 30 * 86400,
    "Registration must close between 2 minutes and 30 days from now",
  );
  const link = await currentLinkAccess(
    env,
    owner,
    d.linkId,
    d.roleIds,
    d.channelId,
  );
  const row: Campaign = {
    id,
    owner,
    revision: 1,
    status: "publishing",
    input_json: JSON.stringify(d),
    payload_hash: hash(d),
    guild_id: link.guild_id,
    channel_id: link.channel_id,
    ends_at: d.endsAt,
    created: now,
    participant_count: 0,
    message_id: null,
    message_state: null,
    publish_started_at: null,
    closed_at: null,
    review_json: JSON.stringify(review),
    error_code: null,
    lease_token: null,
    lease_until: 0,
  };
  return {
    result: publicCampaign(row),
    statements: [
      env.DB.prepare(
        `INSERT INTO discord_campaigns(id,owner,status,input_json,payload_hash,guild_id,channel_id,ends_at,created,review_json)
    SELECT ?,?,'publishing',?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM discord_campaigns WHERE owner=? AND status IN ('publishing','publishing_uncertain','open','closing'))<5
    AND NOT EXISTS(SELECT 1 FROM giveaways WHERE id=?)`,
      ).bind(
        id,
        owner,
        row.input_json,
        row.payload_hash,
        link.guild_id,
        link.channel_id,
        d.endsAt,
        now,
        row.review_json,
        owner,
        id,
      ),
      guard(env.DB),
    ],
  };
}
export function publicCampaign(row: Campaign) {
  const d = JSON.parse(row.input_json) as DiscordCampaignInput;
  return {
    id: row.id,
    owner: row.owner,
    revision: row.revision,
    status: row.status,
    title: d.title,
    description: d.description,
    rules: d.rules,
    winners: d.winners,
    reserves: d.reserves,
    listed: d.listed,
    endsAt: row.ends_at,
    created: row.created,
    closedAt: row.closed_at,
    participantCount: row.participant_count,
    payloadHash: row.payload_hash,
    messageRecoveryRequired:
      !row.message_id &&
      !!row.publish_started_at &&
      ["publishing_uncertain", "cancelled", "expired"].includes(row.status),
    roleIds: d.roleIds || [],
    giveawayId: row.status === "ready" ? row.id : null,
    errorCode: row.error_code,
    messageUrl: row.message_id
      ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.message_id}`
      : null,
  };
}
export async function campaignRow(env: CampaignEnv, id: string) {
  return env.DB.prepare("SELECT * FROM discord_campaigns WHERE id=?")
    .bind(id)
    .first<Campaign>();
}
export async function participantAction(
  env: CampaignEnv,
  interaction: any,
  id: string,
  join: boolean,
) {
  assert(uuid.test(id), "Invalid giveaway ID");
  const user = interaction.member?.user;
  assert(
    user && snowflake.test(user.id) && !user.bot,
    "Use your own Discord account to participate",
  );
  const row = await campaignRow(env, id);
  assert(
    row &&
      row.guild_id === interaction.guild_id &&
      row.channel_id === interaction.channel_id,
    "This button does not belong to this server channel",
  );
  const messageId = interaction.message?.id;
  assert(
    snowflake.test(messageId || ""),
    "This giveaway message is unavailable",
  );
  // A signed component can recover a successful announcement whose HTTP reply was lost.
  await env.DB.prepare(
    "UPDATE discord_campaigns SET message_id=?,message_state='open',status=CASE WHEN status IN ('cancelled','expired') THEN status ELSE 'open' END,error_code=NULL WHERE id=? AND message_id IS NULL AND publish_started_at IS NOT NULL AND status IN ('publishing','publishing_uncertain','cancelled','expired')",
  )
    .bind(messageId, id)
    .run();
  const current = await campaignRow(env, id);
  assert(
    current?.message_id === messageId,
    "Use the original giveaway message",
  );
  const eligible = `EXISTS(SELECT 1 FROM discord_campaigns c JOIN users u ON u.address=c.owner WHERE c.id=? AND c.status='open' AND c.ends_at>unixepoch() AND u.suspended=0)`;
  const requiredRoles =
    (JSON.parse(row.input_json) as DiscordCampaignInput).roleIds || [];
  if (join && requiredRoles.length)
    assert(
      Array.isArray(interaction.member?.roles) &&
        requiredRoles.some((id) => interaction.member.roles.includes(id)),
      "You need at least one of the required server roles to join this giveaway. Roles are checked when you join.",
    );
  const statement = join
    ? env.DB.prepare(
        `INSERT OR IGNORE INTO discord_entries(campaign_id,user_id,display_name,joined_at) SELECT ?,?,?,unixepoch() WHERE ${eligible} AND (SELECT participant_count FROM discord_campaigns WHERE id=?)<10000`,
      ).bind(
        id,
        user.id,
        String(user.global_name || user.username || user.id)
          .normalize("NFC")
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .slice(0, 32),
        id,
        id,
      )
    : env.DB.prepare(
        `DELETE FROM discord_entries WHERE campaign_id=? AND user_id=? AND ${eligible}`,
      ).bind(id, user.id, id);
  const results = await env.DB.batch([
    statement,
    env.DB.prepare(
      `UPDATE discord_campaigns SET participant_count=participant_count${join ? "+" : "-"}changes() WHERE id=?`,
    ).bind(id),
  ]);
  if (results[0].meta.changes)
    return join
      ? "You are in! One Discord account gets one entry. You can leave before registration closes."
      : "Your entry has been removed.";
  const state = await env.DB.prepare(
    "SELECT status,ends_at,participant_count,unixepoch() AS clock FROM discord_campaigns WHERE id=?",
  )
    .bind(id)
    .first<any>();
  if (!state || state.status !== "open" || state.ends_at <= state.clock)
    return "Registration is closed. The participant list cannot be changed.";
  const entered = await env.DB.prepare(
    "SELECT 1 FROM discord_entries WHERE campaign_id=? AND user_id=?",
  )
    .bind(id, user.id)
    .first();
  return join
    ? entered
      ? "You already have an entry."
      : "Registration is unavailable or has reached 10,000 entries."
    : "You do not have an entry in this giveaway.";
}
function announcement(env: CampaignEnv, row: Campaign) {
  const d = JSON.parse(row.input_json) as DiscordCampaignInput,
    open = row.status === "open" || row.status === "publishing";
  const closed = row.status === "ready",
    description = open
      ? `🎉 **Registration is open**\nCloses <t:${row.ends_at}:F> (<t:${row.ends_at}:R>).\nOne entry per Discord account. Join or leave before the deadline. The organizer starts the draw on Lottewy after registration closes.`
      : closed
        ? `🔒 **Entries are closed**\n${row.participant_count} entries are locked. Waiting for the organizer to start the draw. No winners have been selected yet.`
        : row.status === "expired"
          ? "**Expired. No draw was started.**\nRegistration closed over 30 days ago. The participant list and undrawn draft have been removed."
          : row.status === "insufficient"
            ? `Registration closed with ${row.participant_count} entries. There are not enough entries for the announced winner and alternate counts. No draw has started.`
            : "This giveaway registration is unavailable or cancelled.";
  const url =
    new URL(env.APP_ORIGIN).origin + (closed ? "/g/" : "/discord/") + row.id;
  return {
    content: "",
    embeds: [
      {
        title: discordText(d.title.slice(0, 120)),
        url,
        color: 0xb7e968,
        description,
        fields:
          row.status === "expired"
            ? []
            : [
                ...(d.roleIds?.length
                  ? [
                      {
                        name: "Who can join",
                        value:
                          "At least one of: " +
                          d.roleIds.map((id) => `<@&${id}>`).join(", ") +
                          ". Roles are checked when joining.",
                      },
                    ]
                  : []),
                {
                  name: "Selection",
                  value: `${d.winners} winners · ${d.reserves} alternates · equal chances`,
                },
                {
                  name: "Rules",
                  value:
                    discordText(d.rules.slice(0, 450)) +
                    (d.rules.length > 450 ? "… Full rules on Lottewy." : ""),
                },
              ],
        footer: {
          text: "Lottewy · Winners are announced here. The full participant list stays private.",
        },
      },
    ],
    components: [
      ...(open
        ? [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: "🎉 Join",
                  custom_id: "lw:join:" + row.id,
                },
                {
                  type: 2,
                  style: 2,
                  label: "Leave",
                  custom_id: "lw:leave:" + row.id,
                },
              ],
            },
          ]
        : []),
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label:
              row.status === "expired"
                ? "View status"
                : closed
                  ? "View giveaway & proof"
                  : "Rules & registration",
            url,
          },
        ],
      },
    ],
    allowed_mentions: discordMentions,
  };
}
export async function recoverCampaignMessage(
  env: CampaignEnv,
  owner: string,
  id: string,
  messageId: string,
) {
  assert(snowflake.test(messageId), "Enter the Discord message ID");
  const row = await campaignRow(env, id);
  assert(
    row?.owner === owner &&
      !row.message_id &&
      !!row.publish_started_at &&
      ["publishing_uncertain", "cancelled", "expired"].includes(row.status),
    "This campaign does not need message recovery",
  );
  const botId = await botIdentity(env),
    message = await discordApi(
      env,
      `/channels/${row.channel_id}/messages/${messageId}`,
    );
  assert(
    message.author?.id === botId &&
      message.channel_id === row.channel_id &&
      message.components?.some((r: any) =>
        r.components?.some((c: any) => c.custom_id === "lw:join:" + id),
      ),
    "This is not the original Lottewy giveaway message",
  );
  return [
    env.DB.prepare(
      "UPDATE discord_campaigns SET message_id=?,message_state='open',status=CASE WHEN status='publishing_uncertain' THEN 'open' ELSE status END,error_code=NULL WHERE id=? AND owner=? AND message_id IS NULL AND publish_started_at IS NOT NULL AND status IN ('publishing_uncertain','cancelled','expired')",
    ).bind(messageId, id, owner),
    guard(env.DB),
  ];
}
export async function processDiscordCampaigns(env: CampaignEnv) {
  if (!env.DISCORD_BOT_TOKEN) return;
  const work = await env.DB.prepare(
    `SELECT id FROM discord_campaigns WHERE status='publishing' OR status='closing' OR (status='open' AND ends_at<=unixepoch())
   OR (message_id IS NOT NULL AND COALESCE(message_state,'')<>CASE WHEN status='ready' THEN COALESCE((SELECT 'result:'||CASE WHEN hidden=1 THEN 'hidden' ELSE g.status END FROM giveaways g WHERE g.id=discord_campaigns.id),'ready') ELSE status END AND status IN ('ready','insufficient','cancelled','expired')) ORDER BY checked_at LIMIT 3`,
  ).all<{ id: string }>();
  for (const item of work.results) {
    const token = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      "UPDATE discord_campaigns SET lease_token=?,lease_until=unixepoch()+60 WHERE id=? AND lease_until<unixepoch()",
    )
      .bind(token, item.id)
      .run();
    if (!claimed.meta.changes) continue;
    try {
      let row = (await campaignRow(env, item.id))!;
      if (row.status === "publishing") {
        if (row.publish_started_at) {
          await env.DB.prepare(
            "UPDATE discord_campaigns SET status='publishing_uncertain',error_code='MESSAGE_DELIVERY_UNCERTAIN' WHERE id=? AND lease_token=?",
          )
            .bind(row.id, token)
            .run();
          continue;
        }
        await currentLinkAccess(
          env,
          row.owner,
          (JSON.parse(row.input_json) as DiscordCampaignInput).linkId,
          (JSON.parse(row.input_json) as DiscordCampaignInput).roleIds,
          row.channel_id,
        );
        const started = await env.DB.prepare(
          "UPDATE discord_campaigns SET publish_started_at=unixepoch() WHERE id=? AND status='publishing' AND publish_started_at IS NULL AND ends_at>unixepoch() AND lease_token=? AND lease_until>unixepoch() AND EXISTS(SELECT 1 FROM users WHERE address=discord_campaigns.owner AND suspended=0)",
        )
          .bind(row.id, token)
          .run();
        if (!started.meta.changes) {
          await env.DB.prepare(
            "UPDATE discord_campaigns SET status='cancelled',closed_at=COALESCE(closed_at,unixepoch()),error_code='PUBLICATION_EXPIRED' WHERE id=? AND lease_token=?",
          )
            .bind(row.id, token)
            .run();
          continue;
        }
        const message = await discordApi(
          env,
          `/channels/${row.channel_id}/messages`,
          "POST",
          {
            ...announcement(env, row),
            nonce: BigInt("0x" + row.id.replaceAll("-", "")).toString(36),
            enforce_nonce: true,
          },
        );
        assert(snowflake.test(message.id), "Discord returned no message ID");
        await env.DB.prepare(
          "UPDATE discord_campaigns SET message_id=?,message_state='open',status=CASE WHEN status='cancelled' THEN status ELSE 'open' END,error_code=NULL WHERE id=? AND status IN ('publishing','cancelled') AND lease_token=? AND lease_until>unixepoch()",
        )
          .bind(message.id, row.id, token)
          .run();
        continue;
      }
      if (row.status === "open")
        await env.DB.prepare(
          "UPDATE discord_campaigns SET status='closing',closed_at=unixepoch() WHERE id=? AND status='open' AND ends_at<=unixepoch() AND lease_token=? AND lease_until>unixepoch()",
        )
          .bind(row.id, token)
          .run();
      row = (await campaignRow(env, item.id))!;
      if (row.status === "closing") {
        const participants = await env.DB.prepare(
          "SELECT user_id,display_name FROM discord_entries WHERE campaign_id=? ORDER BY length(user_id),user_id",
        )
          .bind(row.id)
          .all<{ user_id: string; display_name: string }>();
        const d = JSON.parse(row.input_json) as DiscordCampaignInput;
        assert(
          participants.results.length === row.participant_count &&
            participants.results.length <= 10000,
          "The participant snapshot needs reconciliation",
        );
        if (participants.results.length < Math.max(2, d.winners + d.reserves)) {
          await env.DB.prepare(
            "UPDATE discord_campaigns SET status='insufficient',error_code='NOT_ENOUGH_ENTRIES' WHERE id=? AND status='closing' AND lease_token=? AND lease_until>unixepoch()",
          )
            .bind(row.id, token)
            .run();
        } else {
          const draft = normalize({
            title: d.title,
            description: d.description,
            rules: d.rules,
            winners: d.winners,
            reserves: d.reserves,
            listed: d.listed,
            entries: participants.results.map(
              (p) => `${p.display_name} [Discord ${p.user_id}]`,
            ),
          });
          const built = makeManifest(draft, row.id, row.owner, 1),
            evaluation = JSON.parse(row.review_json);
          const g: Giveaway = {
            id: row.id,
            slug: row.id,
            owner: row.owner,
            revision: 1,
            status: "draft",
            created: row.created,
            listed: d.listed,
            manifest: built.manifest,
            commitment: built.commitment,
            review: {
              mode: evaluation.mode,
              model: evaluation.model,
              policy: evaluation.policy,
            },
            registration: {
              kind: "discord",
              campaignId: row.id,
              closedAt: row.closed_at!,
            },
          };
          const text = JSON.stringify(g);
          assert(
            new TextEncoder().encode(text).length < 1800000,
            "Public manifest is too large",
          );
          const stored = storeJson(env.DB, `discord-private:${row.id}`, {
            draft,
            entries: built.privateEntries,
          });
          await env.DB.batch([
            env.DB.prepare(
              "UPDATE discord_campaigns SET status='ready',error_code=NULL WHERE id=? AND status='closing' AND lease_token=? AND lease_until>unixepoch()",
            ).bind(row.id, token),
            guard(env.DB),
            ...stored.statements,
            env.DB.prepare(
              "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created,listed) VALUES (?,?,?,1,'draft',?,?,?,?)",
            ).bind(
              row.id,
              row.id,
              row.owner,
              text,
              stored.reference,
              row.created,
              Number(d.listed),
            ),
            env.DB.prepare(
              "INSERT INTO revisions(giveaway_id,revision,public_json,private_json,review_json) VALUES (?,1,?,?,?)",
            ).bind(row.id, text, stored.reference, row.review_json),
            env.DB.prepare("DELETE FROM atomic_guard"),
          ]);
        }
      }
      row = (await campaignRow(env, item.id))!;
      const resultRecord =
        row.status === "ready"
          ? await env.DB.prepare(
              "SELECT public_json,private_json,status,hidden FROM giveaways WHERE id=?",
            )
              .bind(row.id)
              .first<{
                public_json: string;
                private_json: string;
                status: string;
                hidden: number;
              }>()
          : null;
      const messageState = resultRecord
        ? "result:" + (resultRecord.hidden ? "hidden" : resultRecord.status)
        : row.status;
      if (
        row.message_id &&
        row.message_state !== messageState &&
        ["ready", "insufficient", "cancelled", "expired"].includes(row.status)
      ) {
        await discordApi(
          env,
          `/channels/${row.channel_id}/messages/${row.message_id}`,
          "PATCH",
          resultRecord
            ? await campaignResultMessage(env, resultRecord)
            : announcement(env, row),
        );
        await env.DB.prepare(
          "UPDATE discord_campaigns SET message_state=?,error_code=NULL WHERE id=? AND status=? AND lease_token=? AND lease_until>unixepoch()",
        )
          .bind(messageState, row.id, row.status, token)
          .run();
      }
    } catch {
      await env.DB.prepare(
        "UPDATE discord_campaigns SET status=CASE WHEN status='publishing' AND publish_started_at IS NOT NULL THEN 'publishing_uncertain' ELSE status END,error_code='DISCORD_PROCESSING_UNAVAILABLE' WHERE id=? AND lease_token=? AND lease_until>unixepoch()",
      )
        .bind(item.id, token)
        .run();
    } finally {
      await env.DB.prepare(
        "UPDATE discord_campaigns SET checked_at=unixepoch(),lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?",
      )
        .bind(item.id, token)
        .run();
    }
  }
}
