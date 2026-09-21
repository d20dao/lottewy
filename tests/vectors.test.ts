import { it, expect } from "vitest";
import { makeManifest, select, hash, type Draft } from "../shared/core";
import vector from "../docs/testnet-e2e.json";
import weightedVector from "../docs/testnet-weighted-e2e.json";
import weightedGiveaway from "../docs/testnet-weighted-public-manifest.json";
it("real Arc testnet word produces the recorded ordered entry IDs from the preserved public manifest", async () => {
  // Permanent vector is the full public snapshot, not a live API dependency.
  const { default: giveaway } =
    await import("../docs/testnet-public-manifest.json");
  expect(hash(giveaway.manifest)).toBe(vector.commitment);
  expect(
    select(
      giveaway.manifest as any,
      vector.word as `0x${string}`,
      vector.commitment as `0x${string}`,
    ),
  ).toEqual(vector.outcome);
});
it("weighted testnet vector stays reproducible across future releases", () => {
  expect(hash(weightedGiveaway.manifest)).toBe(weightedVector.commitment);
  expect(
    select(
      weightedGiveaway.manifest as any,
      weightedVector.word as `0x${string}`,
      weightedVector.commitment as `0x${string}`,
    ),
  ).toEqual(weightedVector.outcome);
});
