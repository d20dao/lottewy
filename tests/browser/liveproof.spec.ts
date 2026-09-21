import { test, expect } from "@playwright/test";
import giveaway from "../../docs/testnet-v2-public-giveaway.json" with { type: "json" };
test("real testnet result verifies VRF evidence in the browser", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_PROOF_CHECK !== "1",
    "Explicit read-only live RPC check",
  );
  // Serve the public fixture locally; all verification RPC reads remain real.
  await page.route(`**/api/giveaways/${giveaway.slug}`, (route) =>
    route.fulfill({ json: giveaway }),
  );
  for (const result of [
    { slug: giveaway.slug, requestId: giveaway.evidence.requestId },
  ]) {
    await page.goto(`/g/${result.slug}`);
    await page
      .getByRole("button", { name: "Reveal instantly", exact: true })
      .click();
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.getByRole("button", { name: "Verify onchain proof" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "VRF proof, pinned public key, request and consumer bindings verified",
      { timeout: 25000 },
    );
    await expect(
      page.getByText("Onchain proof verified", { exact: true }),
    ).toBeVisible();
    const verifyButton = (await page
        .getByRole("button", { name: "Verify onchain proof" })
        .boundingBox())!,
      transactionLink = (await page
        .getByRole("link", { name: "View transaction", exact: true })
        .boundingBox())!;
    expect(
      transactionLink.x - (verifyButton.x + verifyButton.width) >= 12 ||
        transactionLink.y - (verifyButton.y + verifyButton.height) >= 8,
    ).toBe(true);
    await page.getByRole("button", { name: "Replay the selection" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Selection reproduced",
    );
    await page.screenshot({
      path: `artifacts/live-proof-${result.requestId}.png`,
      fullPage: true,
    });
  }
});
