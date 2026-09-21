import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { select, hash } from "../../shared/core";
import giveaway from "../../docs/testnet-v2-public-giveaway.json" with { type: "json" };
for (const live of [false, true])
  test(`${live ? "real onchain" : "demo"} proof JSON download can reproduce the recorded winner order`, async ({
    page,
  }) => {
    test.skip(
      live && process.env.LIVE_PROOF_CHECK !== "1",
      "Read-only live verification is opt-in",
    );
    if (live)
      await page.route(`**/api/giveaways/${giveaway.slug}`, (route) =>
        route.fulfill({ json: giveaway }),
      );
    await page.goto(live ? `/g/${giveaway.slug}` : "/demo");
    await page
      .getByRole("button", { name: "Reveal instantly", exact: true })
      .click();
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download proof JSON", exact: true })
      .click();
    const download = await waiting;
    expect(download.suggestedFilename()).toMatch(/-proof\.json$/);
    const bundle = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(bundle.schema).toBe("lottewy-proof-bundle-v1");
    expect(hash(bundle.manifest)).toBe(bundle.commitment);
    expect(bundle.results.winners.map((entry: any) => entry.id)).toEqual(
      select(bundle.manifest, bundle.randomWord, bundle.commitment).winners,
    );
    expect(
      bundle.manifest.entries.every(
        (entry: any) => !("raw" in entry) && !("salt" in entry),
      ),
    ).toBe(true);
    expect(bundle.kind).toBe(live ? "onchain" : "demo");
    if (live) {
      expect(bundle.onchain.requestId).toBe(giveaway.evidence.requestId);
      expect(bundle.onchain.vrf.packet).toMatch(/^0x[0-9a-f]+$/i);
      expect(bundle.onchain.vrf.publicKey).toHaveLength(2);
    } else expect(bundle.onchain).toBeNull();
  });
