import { describe, it, expect } from "vitest";
import { makeManifest, select, hash, type Giveaway } from "../shared/core";
import { proofBundle, serializeProofBundle } from "../shared/proof-bundle";
const word = hash("word"),
  owner = "0x0000000000000000000000000000000000000001";
function fixture(weighted = false) {
  const draft = {
    title: "Synthetic export",
    description: "Public details",
    rules: "Free weighted or equal selection.",
    entries: [
      "Alice Private",
      "bob@example.invalid",
      "Chris Private",
      "Dana Private",
    ],
    winners: 2,
    reserves: 1,
    ...(weighted ? { weights: [1, 2, 3, 4] } : {}),
  };
  const built = makeManifest(draft, "export-fixture", owner, 1);
  const g = {
    id: "export-fixture",
    slug: "export-fixture",
    owner,
    revision: 1,
    status: "completed",
    created: 1,
    manifest: built.manifest,
    commitment: built.commitment,
    review: { mode: "live", model: "test", policy: "test" },
    evidence: {
      word,
      requestId: "12",
      chainId: 5042002,
      coordinator: owner,
      consumer: owner,
      txHash: hash("request"),
      blockHash: hash("block"),
      blockNumber: "100",
    },
  } as Giveaway;
  return { g, built, draft };
}
describe("portable public proof export", () => {
  for (const weighted of [false, true])
    it(`replays ${weighted ? "weighted" : "equal"} results and excludes private source data`, () => {
      const { g, built, draft } = fixture(weighted);
      const bundle = proofBundle(
        { ...g, private: { draft, entries: built.privateEntries } } as any,
        word,
        undefined,
        true,
      );
      const json = serializeProofBundle(bundle),
        roundtrip = JSON.parse(json);
      const replay = select(
        roundtrip.manifest,
        roundtrip.randomWord,
        roundtrip.commitment,
      );
      expect(roundtrip.results.winners.map((x: any) => x.id)).toEqual(
        replay.winners,
      );
      expect(roundtrip.results.alternates.map((x: any) => x.id)).toEqual(
        replay.reserves,
      );
      expect(roundtrip.selection.steps).toHaveLength(3);
      for (const value of [
        ...draft.entries,
        ...built.privateEntries.map((e) => e.salt),
      ])
        expect(json).not.toContain(value);
      expect(roundtrip.kind).toBe("demo");
      expect(roundtrip.onchain).toBeNull();
    });
  it("requires verified evidence for real exports and rejects mismatched words or commitments", () => {
    const { g } = fixture();
    expect(() => proofBundle(g, word)).toThrow("Onchain verification");
    expect(() =>
      proofBundle({ ...g, commitment: hash("wrong") }, word, undefined, true),
    ).toThrow("commitment");
    const proof = {
      valid: true,
      word,
      requestId: "12",
      packet: "0x1234",
      proofHash: hash("proof"),
      transcriptHash: hash("transcript"),
      acceptanceTx: hash("acceptance"),
      scope: "test scope",
      publicKey: ["1", "2"],
      request: { requestBlock: 100n },
    } as any;
    const bundle = JSON.parse(
      serializeProofBundle(proofBundle(g, word, proof)),
    );
    expect(bundle.onchain.vrf.packet).toBe("0x1234");
    expect(bundle.onchain.vrf.request.requestBlock).toBe("100");
    expect(() => proofBundle(g, word, { ...proof, requestId: "13" })).toThrow(
      "Onchain verification",
    );
    expect(() => proofBundle({ ...g, status: "waiting" }, word, proof)).toThrow(
      "completed",
    );
  });
});
