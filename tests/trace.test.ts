import { it, expect } from "vitest";
import { keccak256, concatHex, toHex, type Hex } from "viem";
import { traceSelection, select, type Manifest } from "../shared/core";
import equal from "../docs/testnet-public-manifest.json";
import weighted from "../docs/testnet-weighted-public-manifest.json";
for (const fixture of [equal, weighted])
  it(`visual trace uses the exact ${fixture.manifest.algorithm} calculation`, () => {
    const m = fixture.manifest as Manifest,
      word = fixture.evidence.word as Hex,
      commitment = fixture.commitment as Hex;
    const trace = traceSelection(m, word, commitment),
      result = select(m, word, commitment);
    expect(trace.outcome).toEqual(result);
    expect(trace.steps.map((s) => s.entryId)).toEqual([
      ...result.winners,
      ...result.reserves,
    ]);
    for (const step of trace.steps) {
      expect(step.derivedHash).toBe(
        keccak256(
          concatHex([
            toHex(trace.domain),
            commitment,
            word,
            toHex(BigInt(step.counter), { size: 32 }),
          ]),
        ),
      );
      expect(BigInt(step.sample)).toBe(BigInt(step.derivedHash));
      expect(BigInt(step.sample)).toBeLessThan(BigInt(step.limit));
      expect(Number(BigInt(step.sample) % BigInt(step.range))).toBe(
        step.ticket,
      );
      expect(step.ticket).toBeGreaterThanOrEqual(step.intervalStart);
      expect(step.ticket).toBeLessThan(step.intervalEnd);
      expect(step.nearby?.some((e) => e.id === step.entryId)).toBe(true);
      expect(step.nearby!.length).toBeLessThanOrEqual(5);
    }
  });
