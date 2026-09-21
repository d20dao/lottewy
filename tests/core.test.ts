import { describe, it, expect } from "vitest";
import {
  canonical,
  hash,
  lines,
  mask,
  normalize,
  makeManifest,
  select,
  type Draft,
} from "../shared/core";
const draft: Draft = {
  title: "Demo giveaway",
  description: "",
  rules: "Eşit şans ve ücretsiz entries.",
  entries: ["Deniz Yılmaz", "ayse@example.com", "Mert Kaya", "Elif Arslan"],
  winners: 2,
  reserves: 1,
};
const owner = "0x0000000000000000000000000000000000000001";
const salt = `0x${"11".repeat(32)}` as const,
  word = `0x${"42".repeat(32)}` as const;
describe("normalization and privacy", () => {
  it("preserves order and internal whitespace; trims, removes blanks and NFC normalizes", () => {
    expect(lines(" A  B\r\n\n e\u0301 ").entries).toEqual(["A  B", "é"]);
    expect(lines("A\n\nB").blanks).toBe(1);
  });
  it("detects duplicates including case-insensitive wallet addresses", () => {
    expect(lines(`${owner}\n${owner}`).duplicates).toEqual([2]);
    expect(() => normalize({ ...draft, entries: ["Ada", "Ada"] })).toThrow(
      "Duplicate",
    );
  });
  it("rejects invalid limits and newline injection", () => {
    expect(() => normalize({ ...draft, entries: ["X\nY", "Z"] })).toThrow();
    expect(() => normalize({ ...draft, winners: 5 })).toThrow();
    expect(() =>
      normalize({ ...draft, entries: ["é".repeat(129), "B"] }),
    ).toThrow();
  });
  it("never publishes mixed wallet and personal data", () => {
    expect(mask(owner, 1)).toBe(owner);
    expect(mask(`${owner} Alice alice@example.com`, 2)).toBe("Entry #2");
    expect(mask("alice@example.com", 1)).toBe("a***@e***.com");
    expect(mask("https://secret.example", 1)).toBe("Entry #1");
  });
  it("public manifest contains no raw private values or salts", () => {
    const m = makeManifest(draft, "id", owner, 1);
    const text = JSON.stringify(m.manifest);
    expect(text).not.toContain("Deniz");
    expect(text).not.toContain("ayse@example.com");
    expect(text).not.toContain(m.privateEntries[0].salt);
    expect(m.manifest.entries[0].commitment).not.toBe(
      makeManifest(draft, "id", owner, 1).manifest.entries[0].commitment,
    );
  });
});
describe("versioned replay", () => {
  it("canonical format is typed, length-prefixed and key order independent", () => {
    expect(canonical({ b: 1, a: "é" })).toBe(
      "o2:{s1:as2:éi1;".replace("i1;", "") + "s1:bi1;}",
    );
    expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
    expect(hash(["ab", "c"])).not.toBe(hash(["a", "bc"]));
    expect(() => canonical(NaN)).toThrow();
  });
  it("replays same order without repeats for all selected entries", () => {
    const m = makeManifest(
      draft,
      "id",
      owner,
      1,
      draft.entries.map(() => salt),
    );
    const a = select(m.manifest, word, m.commitment);
    expect(a).toEqual(select(m.manifest, word, m.commitment));
    expect(new Set([...a.winners, ...a.reserves]).size).toBe(3);
  });
  it("rejects tampered labels, rules, ordering and unsupported algorithm", () => {
    const m = makeManifest(draft, "id", owner, 1);
    for (const field of ["title", "rules", "algorithm"])
      expect(() =>
        select({ ...m.manifest, [field]: "tampered" }, word, m.commitment),
      ).toThrow();
    expect(() =>
      select(
        { ...m.manifest, entries: [...m.manifest.entries].reverse() },
        word,
        m.commitment,
      ),
    ).toThrow();
  });
  it("selects a complete 10k population without duplication", () => {
    const m = makeManifest(
      {
        ...draft,
        entries: Array.from({ length: 10000 }, (_, i) => `entry ${i}`),
        winners: 100,
        reserves: 100,
      },
      "large",
      owner,
      1,
    );
    const a = select(m.manifest, word, m.commitment);
    expect(new Set([...a.winners, ...a.reserves]).size).toBe(200);
  });
});
