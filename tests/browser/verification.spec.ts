import { test, expect } from "@playwright/test";
import evidence from "../../docs/testnet-weighted-e2e.json" with { type: "json" };
test("animated verification shows actual hashes, formulas, sampled range and next selections", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(`/g/${evidence.slug}`);
  await page.getByRole("button", { name: "Proof details" }).click();
  await page.getByRole("button", { name: "Replay the selection" }).click();
  await expect(page.locator(".computation-flow")).toBeVisible();
  await expect(page.locator(".formula")).toContainText("Keccak256");
  await expect(
    page.getByText("Replay verified", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trace-result")).toContainText("#0004");
  await expect(page.locator(".hash-inputs code").nth(1)).toHaveAttribute(
    "data-value",
    evidence.word,
  );
  await page.screenshot({
    path: "artifacts/verification-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next selection" }).click();
  await expect(page.locator(".trace-result")).toContainText("#0002");
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
