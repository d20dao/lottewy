import { test, expect } from "@playwright/test";

test("editor disclosures preserve staged import, return focus and keep undo feedback stable", async ({
  page,
}) => {
  await page.goto("/create");
  const trigger = page.getByRole("button", {
    name: "Import CSV or spreadsheet",
  });
  const panel = page.locator("#csv-import-panel");
  await expect(panel).toHaveAttribute("inert", "");
  await trigger.click();
  await expect(panel).not.toHaveAttribute("inert");
  await page.getByText("Or paste cells from a spreadsheet").click();
  await page.getByLabel("Spreadsheet cells").fill("Name\nAlex\nSam");
  await page.getByRole("button", { name: "Close import" }).click();
  await expect(trigger).toBeFocused();
  await expect(panel).toHaveAttribute("inert", "");
  await trigger.click();
  await expect(page.getByLabel("Spreadsheet cells")).toHaveValue(
    "Name\nAlex\nSam",
  );
  await page.getByRole("button", { name: "Close import" }).click();
  await expect(panel).not.toBeVisible();
  const before = await page.locator(".edit-notice").boundingBox();
  await page.getByRole("button", { name: "Use sample list" }).click();
  const after = await page.locator(".edit-notice").boundingBox();
  expect(after!.height).toBe(before!.height);
  const preview = page.getByRole("button", {
    name: "Public appearance",
    exact: true,
  });
  await preview.click();
  await expect(page.locator(".appearance-pagination")).not.toBeVisible();
  await preview.click();
  await expect(page.locator(".appearance-pagination")).toBeVisible();
});

test("mobile navigation dismisses with Escape and dialog padding keeps proof open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open menu", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Reveal instantly" }).click();
  const verify = page.getByRole("button", { name: "Verify", exact: true });
  await verify.click();
  const dialog = page.getByRole("dialog");
  await dialog.click({ position: { x: 3, y: 80 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(verify).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("reduced-motion disclosures open immediately and stay keyboard accessible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/create");
  await page.getByRole("button", { name: "Import CSV or spreadsheet" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose the entries to import" }),
  ).toBeVisible();
  const animations = await page
    .locator("#csv-import-panel")
    .evaluate((element) => element.getAnimations().length);
  expect(animations).toBe(0);
  await page.getByRole("button", { name: "Close import" }).click();
  await expect(page.locator("#csv-import-panel")).not.toBeVisible();
});
