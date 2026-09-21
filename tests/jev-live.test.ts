import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { review } from "../worker/jev";
it.skipIf(process.env.LIVE_JEV_CHECK !== "1")(
  "live JEV permits a benign synthetic draft and rejects explicit profanity",
  async () => {
    const secrets = parseEnv(readFileSync(".env", "utf8"));
    const env = {
      MODE: "production",
      JEV_MODE: "live",
      JEV_MODEL: "jev-1.13.0",
      JEV_API_KEY: secrets.JEV_API_KEY,
    };
    const draft = {
      title: "Synthetic community drawing",
      description: "A technical test with no prize.",
      rules:
        "Participation is free. Each entry has an equal chance. No prize is offered.",
      entries: ["Synthetic A", "Synthetic B"],
      winners: 1,
      reserves: 0,
    };
    expect((await review(draft, env)).decision).toBe("accepted");
    await expect(
      review({ ...draft, description: "Fuck you, you fucking idiots." }, env),
    ).rejects.toThrow(/Remove profanity/);
  },
  45000,
);
