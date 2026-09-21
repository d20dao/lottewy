import {
  hash,
  select,
  CHAIN_ID,
  COORDINATOR,
  type Giveaway,
} from "../shared/core";
import { arc } from "../shared/chain";
import {
  verifyChannel,
  participantAction,
  DiscordCampaignError,
} from "./discord-campaigns";

export type DiscordEnv = {
  DB: D1Database;
  APP_ORIGIN: string;
  CONSUMER_ADDRESS: string;
  AGENT_API_ORIGIN?: string;
  DISCORD_APP_ID?: string;
  DISCORD_APP_PUBLIC_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
};
type Source = "web" | "agent";
type Target = { id: string; page: number; source?: Source };
type InteractionAction =
  | { kind: "result"; target: Target }
  | { kind: "verify"; code: string }
  | { kind: "entry"; id: string; join: boolean };
type Message = {
  content?: string;
  embeds: unknown[];
  components: unknown[];
  allowed_mentions: { parse: string[] };
};
const allowed_mentions = { parse: [] as string[] };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const snowflake = /^\d{17,20}$/;
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
const errorMessage = (content: string): Message => ({
  content,
  embeds: [],
  components: [],
  allowed_mentions,
});
const ephemeral = (content: string) =>
  json({ type: 4, data: { ...errorMessage(content), flags: 64 } });
const hex = (text: string) =>
  Uint8Array.from(text.match(/../g)!, (byte) => parseInt(byte, 16));
const escapeText = (text: string) =>
  text.replace(/[\\`*_{}\[\]()<>~|]/g, "\\$&");

async function limitedBody(request: Pick<Request, "body">, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Body limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

async function readGiveaway(
  env: DiscordEnv,
  target: Target,
): Promise<{ g: Giveaway; source: Source } | null> {
  if (target.source !== "agent") {
    const row = await env.DB.prepare(
      "SELECT public_json,status,hidden FROM giveaways WHERE id=?",
    )
      .bind(target.id)
      .first<{ public_json: string; status: string; hidden: number }>();
    if (row)
      return row.hidden
        ? null
        : {
            g: { ...JSON.parse(row.public_json), status: row.status },
            source: "web",
          };
    if (target.source === "web") return null;
  }
  if (!env.AGENT_API_ORIGIN) return null;
  const origin = new URL(env.AGENT_API_ORIGIN);
  if (origin.protocol !== "https:") return null;
  const response = await fetch(new URL("/v1/giveaways/" + target.id, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await limitedBody(response, 2000000),
    ),
  );
  if (!data.giveaway || data.giveaway.hidden) return null;
  return { g: { ...data.giveaway, status: data.status }, source: "agent" };
}

export function giveawayMessage(
  env: DiscordEnv,
  g: Giveaway,
  target: Target,
  source: Source,
): Message {
  if (g.id !== target.id || g.hidden)
    return errorMessage("This giveaway is not available.");
  const origin = new URL(env.APP_ORIGIN).origin;
  const url =
    origin +
    (source === "agent" ? "/agent/" : "/g/") +
    encodeURIComponent(g.id);
  if (g.status !== "completed")
    return {
      content:
        "This giveaway has no completed result yet. No winners were selected by this command.",
      embeds: [],
      components: [
        {
          type: 1,
          components: [{ type: 2, style: 5, label: "Open giveaway", url }],
        },
      ],
      allowed_mentions,
    };
  const evidence = g.evidence;
  if (
    !g.manifest ||
    !Array.isArray(g.manifest.entries) ||
    g.manifest.entries.length > 10000 ||
    !Number.isInteger(g.manifest.winners) ||
    g.manifest.winners < 1 ||
    g.manifest.winners > 100 ||
    !Number.isInteger(g.manifest.reserves) ||
    g.manifest.reserves < 0 ||
    g.manifest.reserves > 100
  )
    throw new Error("Invalid manifest limits");
  if (
    !evidence ||
    evidence.chainId !== CHAIN_ID ||
    evidence.consumer.toLowerCase() !== env.CONSUMER_ADDRESS.toLowerCase() ||
    evidence.coordinator.toLowerCase() !== COORDINATOR.toLowerCase() ||
    !/^0x[\da-f]{64}$/i.test(evidence.txHash) ||
    !/^0x[\da-f]{64}$/i.test(evidence.word) ||
    !/^\d{1,78}$/.test(evidence.requestId) ||
    hash(g.manifest) !== g.commitment
  )
    throw new Error("Result binding mismatch");
  const result = select(g.manifest, evidence.word, g.commitment);
  const selections = [
    ...result.winners.map((id, i) => ({ id, rank: i + 1, kind: "Winner" })),
    ...result.reserves.map((id, i) => ({ id, rank: i + 1, kind: "Alternate" })),
  ];
  const pages = Math.max(1, Math.ceil(selections.length / 10)),
    page = Math.min(target.page, pages);
  const visible = selections.slice((page - 1) * 10, page * 10);
  const fields = ["Winner", "Alternate"].flatMap((kind) => {
    const lines = visible
      .filter((item) => item.kind === kind)
      .map((item) => {
        const entry = g.manifest.entries.find((e) => e.id === item.id);
        if (!entry) throw new Error("Entry missing");
        const label = /^0x[\da-f]{40}$/i.test(entry.label)
          ? entry.label
          : escapeText(entry.label.slice(0, 32)) +
            (entry.label.length > 32 ? "…" : "");
        return `**${item.rank}.** ${label} · entry ${entry.id}`;
      });
    return lines.length
      ? [
          {
            name: kind === "Winner" ? "🏆 Winners" : "Alternates",
            value: lines.join("\n"),
            inline: false,
          },
        ]
      : [];
  });
  const buttons: unknown[] = [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: "View result & proof", url },
        {
          type: 2,
          style: 5,
          label: "Onchain transaction",
          url: `${arc.blockExplorers.default.url}/tx/${evidence.txHash}`,
        },
      ],
    },
  ];
  if (pages > 1)
    buttons.push({
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Previous",
          custom_id: `lw:${source}:${target.id}:${Math.max(1, page - 1)}`,
          disabled: page === 1,
        },
        {
          type: 2,
          style: 2,
          label: "Next",
          custom_id: `lw:${source}:${target.id}:${Math.min(pages, page + 1)}`,
          disabled: page === pages,
        },
      ],
    });
  return {
    content: "",
    embeds: [
      {
        title: escapeText(g.manifest.title.slice(0, 120)),
        url,
        color: 0xb7e968,
        description: `**Recorded giveaway result**\n${result.winners.length} winner${result.winners.length === 1 ? "" : "s"} · ${result.reserves.length} alternate${result.reserves.length === 1 ? "" : "s"}\n${g.manifest.entries.some((e) => e.weight !== undefined) ? "Public weighted selection" : "Equal-chance selection"}`,
        fields,
        footer: {
          text: `Lottewy · ${arc.name} · D20DAO #${evidence.requestId} · Page ${page}/${pages}`,
        },
      },
    ],
    components: buttons,
    allowed_mentions,
  };
}

async function deliver(
  env: DiscordEnv,
  interaction: any,
  action: InteractionAction,
) {
  // Persist only a short-lived interaction ID, never a token, member or raw list.
  const now = Math.floor(Date.now() / 1000);
  let message: Message;
  try {
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO discord_interactions(id,expires) VALUES (?,?)",
    )
      .bind(interaction.id, now + 1800)
      .run();
    if (claim.meta.changes !== 1) return;
    const budget = await env.DB.prepare(
      "INSERT INTO rate_limits(bucket,count,expires) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
    )
      .bind(
        "discord:" +
          hash([
            action.kind,
            interaction.guild_id,
            action.kind === "entry"
              ? interaction.member?.user?.id || "unknown"
              : "guild",
            Math.floor(now / 60),
          ]),
        now + 120,
      )
      .first<{ count: number }>();
    if (!budget || budget.count > (action.kind === "result" ? 30 : 10))
      message = errorMessage(
        "Too many lookups in this server. Try again shortly.",
      );
    else if (action.kind === "verify")
      message = errorMessage(
        await verifyChannel(env, interaction, action.code),
      );
    else if (action.kind === "entry")
      message = errorMessage(
        await participantAction(env, interaction, action.id, action.join),
      );
    else {
      const target = action.target,
        result = await readGiveaway(env, target);
      message = result
        ? giveawayMessage(
            env,
            result.g,
            { ...target, source: result.source },
            result.source,
          )
        : errorMessage("No available giveaway was found for that ID.");
    }
  } catch (error) {
    message = errorMessage(
      error instanceof DiscordCampaignError
        ? error.message
        : "The request is temporarily unavailable. Open Lottewy or try the command again.",
    );
  }
  const url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APP_ID}/${encodeURIComponent(interaction.token)}/messages/@original`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (response.ok) return;
      if (response.status !== 429 && response.status < 500) break;
    } catch {
      /* The fixed webhook edit is idempotent; never log its secret token. */
    }
    if (attempt === 0)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.warn("Discord interaction reply unavailable");
}

export async function discordInteraction(
  request: Request,
  env: DiscordEnv,
  ctx?: Pick<ExecutionContext, "waitUntil">,
) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (
    !snowflake.test(env.DISCORD_APP_ID || "") ||
    !/^[\da-f]{64}$/i.test(env.DISCORD_APP_PUBLIC_KEY || "")
  )
    return json({ error: "Discord is not configured" }, 503);
  const timestamp = request.headers.get("X-Signature-Timestamp") || "",
    signature = request.headers.get("X-Signature-Ed25519") || "";
  if (
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[\da-f]{128}$/i.test(signature)
  )
    return json({ error: "Invalid signature" }, 401);
  let raw: Uint8Array;
  try {
    raw = await limitedBody(request, 65536);
  } catch {
    return json({ error: "Request too large" }, 413);
  }
  const prefix = new TextEncoder().encode(timestamp),
    signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hex(env.DISCORD_APP_PUBLIC_KEY!),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "Ed25519",
      key,
      hex(signature),
      signed,
    );
  } catch {}
  if (!verified) return json({ error: "Invalid signature" }, 401);
  let interaction: any;
  try {
    interaction = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    );
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (
    interaction.application_id &&
    interaction.application_id !== env.DISCORD_APP_ID
  )
    return json({ error: "Application mismatch" }, 401);
  if (interaction.type === 1) return json({ type: 1 });
  if (
    interaction.application_id !== env.DISCORD_APP_ID ||
    !snowflake.test(interaction.id || "") ||
    !snowflake.test(interaction.guild_id || "") ||
    typeof interaction.token !== "string" ||
    !interaction.token.length ||
    interaction.token.length > 2048
  )
    return ephemeral("This command is available in Discord servers.");
  let target: Target | undefined;
  let action: InteractionAction | undefined;
  if (interaction.type === 2 && interaction.data?.name === "giveaway") {
    const options = Array.isArray(interaction.data.options)
      ? interaction.data.options
      : [];
    const id = options.find((x: any) => x.name === "id")?.value,
      page = options.find((x: any) => x.name === "page")?.value ?? 1;
    if (
      typeof id === "string" &&
      uuid.test(id) &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= 20
    )
      target = { id: id.toLowerCase(), page };
  } else if (
    interaction.type === 2 &&
    interaction.data?.name === "lottewy-verify"
  ) {
    const code = (
      Array.isArray(interaction.data.options) ? interaction.data.options : []
    ).find((x: any) => x.name === "code")?.value;
    if (typeof code === "string" && uuid.test(code.trim()))
      action = { kind: "verify", code: code.trim().toLowerCase() };
  } else if (
    interaction.type === 3 &&
    typeof interaction.data?.custom_id === "string"
  ) {
    const entry = /^lw:(join|leave):([\da-f-]{36})$/i.exec(
      interaction.data.custom_id,
    );
    if (entry && uuid.test(entry[2]))
      action = {
        kind: "entry",
        id: entry[2].toLowerCase(),
        join: entry[1].toLowerCase() === "join",
      };
    const match = /^lw:(web|agent):([\da-f-]{36}):(\d{1,2})$/i.exec(
      interaction.data.custom_id,
    );
    if (
      match &&
      uuid.test(match[2]) &&
      Number(match[3]) >= 1 &&
      Number(match[3]) <= 20
    )
      target = {
        source: match[1].toLowerCase() as Source,
        id: match[2].toLowerCase(),
        page: Number(match[3]),
      };
  }
  if (target) action = { kind: "result", target };
  if (!action)
    return ephemeral(
      "Use /giveaway with the giveaway ID from its Lottewy result URL.",
    );
  if (!ctx)
    return json({ error: "Interaction processing is unavailable" }, 503);
  ctx.waitUntil(
    deliver(env, interaction, action).catch(() =>
      console.warn("Discord interaction processing unavailable"),
    ),
  );
  return json(
    action.kind !== "result"
      ? { type: 5, data: { flags: 64 } }
      : { type: interaction.type === 3 ? 6 : 5 },
  );
}
