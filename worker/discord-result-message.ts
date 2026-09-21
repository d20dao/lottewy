import {
  hash,
  select,
  CHAIN_ID,
  COORDINATOR,
  type Giveaway,
} from "../shared/core";
import { arc } from "../shared/chain";
import { loadJson } from "./storage";
import { discordMentions, discordText } from "./discord-format";

export async function campaignResultMessage(
  env: { DB: D1Database; APP_ORIGIN: string; CONSUMER_ADDRESS: string },
  record: {
    public_json: string;
    private_json: string;
    status: string;
    hidden: number;
  },
) {
  const g = JSON.parse(record.public_json) as Giveaway,
    url = new URL(env.APP_ORIGIN).origin + "/g/" + g.id;
  const base = {
    content: "",
    allowed_mentions: discordMentions,
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "Open giveaway", url }],
      },
    ],
  };
  if (record.hidden)
    return {
      ...base,
      embeds: [
        {
          title: "Giveaway unavailable",
          description:
            "This giveaway is under review. Results are not currently available.",
          color: 0x7b8172,
        },
      ],
    };
  if (record.status !== "completed") {
    const description =
      record.status === "draft"
        ? "🔒 **Entries are closed**\nWaiting for the organizer to start the draw. The participant list is locked."
        : record.status === "expired"
          ? "**No completed draw**\nThe randomness request expired. Check the giveaway page for its recorded status."
          : "⏳ **Draw in progress**\nEntries are locked. Waiting for the recorded onchain result. This message will update when the result is available.";
    return {
      ...base,
      embeds: [
        {
          title: discordText(g.manifest.title),
          description,
          color: 0xb7e968,
          footer: { text: `${g.manifest.entries.length} entries · Lottewy` },
        },
      ],
    };
  }
  const e = g.evidence;
  if (
    !e ||
    e.chainId !== CHAIN_ID ||
    e.consumer.toLowerCase() !== env.CONSUMER_ADDRESS.toLowerCase() ||
    e.coordinator.toLowerCase() !== COORDINATOR.toLowerCase() ||
    !/^0x[\da-f]{64}$/i.test(e.word) ||
    !/^0x[\da-f]{64}$/i.test(e.txHash) ||
    hash(g.manifest) !== g.commitment ||
    !g.registration
  )
    throw new Error("Discord result binding mismatch");
  const result = select(g.manifest, e.word, g.commitment),
    archive = (await loadJson(env.DB, record.private_json)) as {
      entries: { id: number; raw: string; salt: string }[];
    };
  const lines = (ids: number[]) =>
    ids.map((id, index) => {
      const entry = archive.entries.find((item) => item.id === id),
        publicEntry = g.manifest.entries.find((item) => item.id === id);
      if (
        !entry ||
        !publicEntry ||
        hash(["lottewy-entry-v1", g.id, id, entry.salt, entry.raw]) !==
          publicEntry.commitment
      )
        throw new Error("Discord entry opening mismatch");
      const match = /\[Discord (\d{17,20})\]$/.exec(entry.raw);
      if (!match) throw new Error("Discord identity missing");
      return `${index + 1}. <@${match[1]}> · #${id}`;
    });
  const fields: { name: string; value: string }[] = [];
  for (const [label, ids] of [
    ["🏆 Winners", result.winners],
    ["Alternates", result.reserves.slice(0, 10)],
  ] as const) {
    const entries = lines(ids);
    for (let start = 0; start < entries.length; start += 20)
      fields.push({
        name: start ? label + " (continued)" : label,
        value: entries.slice(start, start + 20).join("\n"),
      });
  }
  if (result.reserves.length > 10)
    fields.push({
      name: "More alternates",
      value: `${result.reserves.length} alternates recorded. Open the giveaway for the complete entry order.`,
    });
  return {
    ...base,
    embeds: [
      {
        title: discordText(g.manifest.title),
        description: `🎉 **The draw is complete**\n${result.winners.length} winner${result.winners.length === 1 ? "" : "s"} selected from ${g.manifest.entries.length} entries. Verify the recorded result on Lottewy.`,
        color: 0xb7e968,
        fields,
        footer: {
          text: "Lottewy · Recorded onchain result. The organizer delivers any prizes.",
        },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "View giveaway", url },
          { type: 2, style: 5, label: "Verify result", url: url + "?verify=1" },
          {
            type: 2,
            style: 5,
            label: "Onchain transaction",
            url: arc.blockExplorers.default.url + "/tx/" + e.txHash,
          },
        ],
      },
    ],
  };
}
