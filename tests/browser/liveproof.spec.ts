import { test, expect } from "@playwright/test";
import evidence from "../../docs/testnet-e2e.json" with { type: "json" };
import weightedEvidence from "../../docs/testnet-weighted-e2e.json" with { type: "json" };
test("real testnet result verifies VRF evidence in the browser", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_PROOF_CHECK !== "1",
    "Explicit read-only live RPC check",
  );
  for (const result of [evidence, weightedEvidence, {slug:'bd826c5d-8fbe-4636-8f19-36f9a106da8b',requestId:'5259'}]) {
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
