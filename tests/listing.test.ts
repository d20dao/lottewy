import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  RULES_MAX_LENGTH,
  hash,
  makeManifest,
  normalize,
  type Draft,
} from "../shared/core";
import { database } from "./d1";
const draft: Draft = {
  title: "Community draw",
  description: "",
  rules: "Free equal-chance selection.",
  entries: ["Synthetic Alice", "Synthetic Bob"],
  winners: 1,
  reserves: 0,
};

describe("signed discoverability and content limits", () => {
  it("preserves legacy signed payloads while accepting explicit listing choices", () => {
    expect(normalize(draft)).toEqual(draft);
    expect(hash(normalize(draft))).toBe(hash(draft));
    expect(normalize({ ...draft, listed: false }).listed).toBe(false);
    expect(normalize({ ...draft, listed: true }).listed).toBe(true);
    expect(hash({ ...draft, listed: false })).not.toBe(
      hash({ ...draft, listed: true }),
    );
  });
  it.each([null, "true", 1, {}, []])(
    "rejects invalid listing preferences: %s",
    (listed) => {
      expect(() => normalize({ ...draft, listed } as any)).toThrow(
        "Explorer listing",
      );
    },
  );
  it("keeps discoverability outside the selection manifest and commitment", () => {
    const salts = draft.entries.map(() => `0x${"11".repeat(32)}` as const);
    const build = (listed: boolean) =>
      makeManifest(
        { ...draft, listed },
        "giveaway",
        "0x0000000000000000000000000000000000000001",
        1,
        salts,
      );
    expect(build(true)).toEqual(build(false));
    expect(build(true).manifest).not.toHaveProperty("listed");
  });
  it("accepts boundary lengths and identifies each overlong field", () => {
    expect(() =>
      normalize({
        ...draft,
        title: "T".repeat(TITLE_MAX_LENGTH),
        description: "D".repeat(DESCRIPTION_MAX_LENGTH),
        rules: "R".repeat(RULES_MAX_LENGTH),
      }),
    ).not.toThrow();
    expect(() =>
      normalize({ ...draft, title: "T".repeat(TITLE_MAX_LENGTH + 1) }),
    ).toThrow("Title");
    expect(() =>
      normalize({
        ...draft,
        description: "D".repeat(DESCRIPTION_MAX_LENGTH + 1),
      }),
    ).toThrow("Description");
    expect(() =>
      normalize({ ...draft, rules: "R".repeat(RULES_MAX_LENGTH + 1) }),
    ).toThrow("Rules");
    expect(() => normalize({ ...draft, title: "ab" })).toThrow("Title");
  });
  it("normalizes text before measuring the existing character limits", () => {
    expect(
      normalize({ ...draft, title: ` ${"e\u0301".repeat(TITLE_MAX_LENGTH)} ` })
        .title,
    ).toHaveLength(TITLE_MAX_LENGTH);
  });
  it("defaults new rows to unlisted and keeps listing separate from admin moderation", () => {
    const db = database();
    try {
      db.sqlite
        .prepare("INSERT INTO users(address,created) VALUES ('owner',0)")
        .run();
      db.sqlite
        .prepare(
          "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created,hidden) VALUES ('id','id','owner',1,'draft','{}','{}',0,1)",
        )
        .run();
      expect(
        db.sqlite
          .prepare("SELECT listed,hidden FROM giveaways WHERE id='id'")
          .get(),
      ).toMatchObject({ listed: 0, hidden: 1 });
      db.sqlite.prepare("UPDATE giveaways SET listed=1 WHERE id='id'").run();
      expect(
        db.sqlite
          .prepare("SELECT listed,hidden FROM giveaways WHERE id='id'")
          .get(),
      ).toMatchObject({ listed: 1, hidden: 1 });
      expect(() =>
        db.sqlite.prepare("UPDATE giveaways SET listed=2 WHERE id='id'").run(),
      ).toThrow();
    } finally {
      db.sqlite.close();
    }
  });
});
