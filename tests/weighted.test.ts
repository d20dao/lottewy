import { describe, it, expect } from "vitest";
import {
  makeManifest,
  normalize,
  select,
  hash,
  WEIGHTED_ALGORITHM,
  type Draft,
} from "../shared/core";
import { readCsv, extractColumn, extractWeights } from "../shared/import";
const draft: Draft = {
  title: "Weighted test",
  description: "",
  rules: "Explicit weighted selection without replacement.",
  entries: ["Alex", "Sam", "Jordan"],
  winners: 2,
  reserves: 1,
  weights: [1, 2, 3],
};
const owner = "0x0000000000000000000000000000000000000001",
  word = `0x${"42".repeat(32)}` as const,
  salt = `0x${"11".repeat(32)}` as const;
describe("weighted selection v2", () => {
  it("commits every public weight and never repeats a selected entry", () => {
    const m = makeManifest(
      normalize(draft),
      "weighted",
      owner,
      1,
      draft.entries.map(() => salt),
    );
    expect(m.manifest.algorithm).toBe(WEIGHTED_ALGORITHM);
    expect(m.manifest.entries.map((e) => e.weight)).toEqual([1, 2, 3]);
    const a = select(m.manifest, word, m.commitment);
    expect(new Set([...a.winners, ...a.reserves]).size).toBe(3);
    expect(select(m.manifest, word, m.commitment)).toEqual(a);
    const changed = {
      ...m.manifest,
      entries: m.manifest.entries.map((e, i) => ({
        ...e,
        weight: i === 0 ? 2 : e.weight,
      })),
    };
    expect(() => select(changed, word, m.commitment)).toThrow("Commitment");
  });
  it("rejects zero, negative, fractional, excessive and misaligned weights", () => {
    for (const weights of [
      [0, 2, 3],
      [-1, 2, 3],
      [1.5, 2, 3],
      [1001, 2, 3],
      [1, 2],
    ])
      expect(() => normalize({ ...draft, weights })).toThrow("weight");
  });
  it("samples first-pick proportions and removes the complete entry weight", () => {
    const m = makeManifest(
      { ...draft, winners: 1, reserves: 0 },
      "distribution",
      owner,
      1,
      draft.entries.map(() => salt),
    );
    const counts = [0, 0, 0];
    for (let i = 0; i < 1200; i++) {
      const r = select(m.manifest, hash(["test-word", i]), m.commitment);
      counts[r.winners[0] - 1]++;
    }
    expect(counts[0]).toBeGreaterThan(150);
    expect(counts[0]).toBeLessThan(250);
    expect(counts[1]).toBeGreaterThan(330);
    expect(counts[1]).toBeLessThan(470);
    expect(counts[2]).toBeGreaterThan(510);
    expect(counts[2]).toBeLessThan(690);
  });
  it("aligns imported weights after skipping blank entry cells", () => {
    const sheet = readCsv("Name,Weight\nAlex,2\n,999\nSam,\nJordan,3");
    const c = extractColumn(sheet, 0, true);
    expect(extractWeights(sheet, c.sourceRows, 1)).toEqual({
      weights: [2, 1, 3],
      invalidRows: [],
    });
    const bad = readCsv("Name,Weight\nAlex,0\nSam,1.5");
    expect(
      extractWeights(bad, extractColumn(bad, 0, true).sourceRows, 1)
        .invalidRows,
    ).toEqual([2, 3]);
  });
  it("handles ten thousand weighted entries without duplicate winners", () => {
    const d = {
      ...draft,
      entries: Array.from({ length: 10000 }, (_, i) => `Entry ${i}`),
      weights: Array.from({ length: 10000 }, (_, i) => (i % 1000) + 1),
      winners: 100,
      reserves: 100,
    };
    const m = makeManifest(d, "large-weighted", owner, 1);
    const r = select(m.manifest, word, m.commitment);
    expect(new Set([...r.winners, ...r.reserves]).size).toBe(200);
  });
});
