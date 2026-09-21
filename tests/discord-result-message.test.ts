import { it, expect } from "vitest";
import { database } from "./d1";
import { makeManifest, normalize, CHAIN_ID, COORDINATOR } from "../shared/core";
import { campaignResultMessage } from "../worker/discord-result-message";

it("fits 100 winners inside Discord embed limits and rejects a tampered identity opening", async () => {
  const db = database(),
    owner = "0x0000000000000000000000000000000000000001",
    id = crypto.randomUUID();
  try {
    const draft = normalize({
      title: "Community results",
      description: "",
      rules: "Free community participation.",
      winners: 100,
      reserves: 10,
      entries: Array.from(
        { length: 110 },
        (_, i) => `Member [Discord ${100000000000000000n + BigInt(i)}]`,
      ),
    });
    const built = makeManifest(draft, id, owner, 1);
    const record = {
      status: "completed",
      hidden: 0,
      public_json: JSON.stringify({
        id,
        ...built,
        registration: { kind: "discord", campaignId: id, closedAt: 1 },
        evidence: {
          chainId: CHAIN_ID,
          coordinator: COORDINATOR,
          consumer: owner,
          word: "0x" + "01".repeat(32),
          txHash: "0x" + "02".repeat(32),
        },
      }),
      private_json: JSON.stringify({ entries: built.privateEntries }),
    };
    const env = {
      DB: db as unknown as D1Database,
      APP_ORIGIN: "https://lottewy.com",
      CONSUMER_ADDRESS: owner,
    };
    const message = await campaignResultMessage(env, record),
      embed = message.embeds[0] as any;
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    expect(embed.fields.every((f: any) => f.value.length <= 1024)).toBe(true);
    expect(
      embed.fields
        .map((f: any) => f.value)
        .join("\n")
        .match(/<@\d+>/g),
    ).toHaveLength(110);
    expect(
      embed.title.length +
        embed.description.length +
        embed.footer.text.length +
        embed.fields.reduce(
          (sum: number, f: any) => sum + f.name.length + f.value.length,
          0,
        ),
    ).toBeLessThan(6000);
    built.privateEntries.forEach(
      (entry) => (entry.raw = "Impostor [Discord 999999999999999999]"),
    );
    record.private_json = JSON.stringify({ entries: built.privateEntries });
    await expect(campaignResultMessage(env, record)).rejects.toThrow(
      "opening mismatch",
    );
  } finally {
    db.sqlite.close();
  }
});
