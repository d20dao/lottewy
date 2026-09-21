import { test, expect } from "@playwright/test";
test("verification walkthrough pauses and resumes without pretending demo randomness is onchain", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Proof details" }).click();
  await page.getByRole("button", { name: "Replay the selection" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Demo data, not an onchain proof", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Onchain proof verified", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("Demo replay matched", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trace-result.matched")).toBeVisible();
});
