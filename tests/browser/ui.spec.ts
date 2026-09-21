import { test, expect } from "@playwright/test";
test("desktop landing, empty explorer and keyboard wallet dialog", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Leave it to chance. Share the proof." }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/landing-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.goto("/explorer");
  await expect(
    page.getByRole("heading", { name: "Chance, on the record." }),
  ).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("editor masks mixed rows and validates duplicate entries", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page.getByLabel("Entry list").fill("Deniz Yılmaz\nDeniz Yılmaz");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(page.locator("#entry-issues")).toContainText("repeated");
  await page.getByLabel("Entry list").fill("");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Community thank-you");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. Participation is free. The organizer delivers the prize.",
    );
  await page.screenshot({
    path: "artifacts/editor-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(page.getByText("PUBLIC PREVIEW")).toBeVisible();
  await expect(page.locator(".public-appearance")).not.toContainText(
    "Alex Morgan",
  );
  await expect(
    page.getByRole("button", { name: "Connect wallet to save" }),
  ).toBeEnabled();
});
test("mobile demo reveal, replay, QR download and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/landing-mobile.png",
    fullPage: true,
  });
  await page.goto("/demo");
  await expect(page.getByText("Demo giveaway", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reveal instantly" }).click();
  await expect(page.locator(".winner")).toHaveCount(3);
  const winners = await page.locator(".winner h2").allTextContents();
  await page.screenshot({
    path: "artifacts/results-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByRole("button", { name: "Replay the selection" }).click();
  await expect(page.getByRole("dialog")).toContainText("Selection reproduced");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Play again" }).click();
  await page.getByRole("button", { name: "Reveal instantly" }).click();
  expect(await page.locator(".winner h2").allTextContents()).toEqual(winners);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share card / QR" }).click();
  expect((await download).suggestedFilename()).toBe("lottewy-demo.png");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/results-desktop.png",
    fullPage: true,
  });
});
