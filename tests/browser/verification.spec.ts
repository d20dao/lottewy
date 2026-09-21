import { test, expect } from "@playwright/test";
import giveaway from "../../docs/testnet-v2-public-giveaway.json" with { type: "json" };
import { select, type Manifest } from "../../shared/core";
import type { Hex } from "viem";
test("animated verification shows actual hashes, formulas, sampled range and next selections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const winners = select(
    giveaway.manifest as Manifest,
    giveaway.evidence.word as Hex,
    giveaway.commitment as Hex,
  ).winners;
  await page.route(`**/api/giveaways/${giveaway.slug}`, (route) =>
    route.fulfill({ json: giveaway }),
  );
  await page.goto(`/g/${giveaway.slug}`);
  await page.getByRole("button", { name: "Proof details" }).click();
  await page.getByRole("button", { name: "Replay the selection" }).click();
  await expect(page.locator(".computation-flow")).toBeVisible();
  await expect(page.locator(".formula")).toContainText("Keccak256");
  await expect(
    page.getByText("Replay verified", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trace-result")).toContainText(
    "#" + String(winners[0]).padStart(4, "0"),
  );
  await expect(page.locator(".hash-inputs code").nth(1)).toHaveAttribute(
    "data-value",
    giveaway.evidence.word,
  );
  await page.screenshot({
    path: "artifacts/verification-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next selection" }).click();
  await expect(page.locator(".trace-result")).toContainText(
    "#" + String(winners[1]).padStart(4, "0"),
  );
  await page.getByText("Inspect exact values", { exact: true }).click();
  await expect(page.locator(".exact-bytes")).toContainText(
    "lottewy-weighted-selection-v2",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/verification-mobile.png",
    fullPage: true,
  });
});
