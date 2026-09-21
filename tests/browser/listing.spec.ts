import { test, expect } from "@playwright/test";
test("Explorer listing is opt-in, survives reload, and appears in review", async ({
  page,
}) => {
  await page.goto("/create");
  const listed = page.getByRole("checkbox", { name: "Show in Explorer" });
  await expect(listed).not.toBeChecked();
  await expect(
    page.getByText("Unlisted: only people with the share link", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Entry list").fill("Alex\nSam");
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Community drawing");
  await page
    .getByLabel("Entry and prize rules")
    .fill("Free participation. Each entry has an equal chance. No prize.");
  await listed.check();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(listed).toBeChecked();
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(
    page.getByText("Listed in Explorer", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/listing-review.png",
    fullPage: true,
  });
});
