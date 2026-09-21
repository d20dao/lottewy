import { test, expect } from "@playwright/test";
test("public preview is paginated and weight editing preserves values across pages", async ({
  page,
}) => {
  await page.goto("/create");
  await page
    .getByLabel("Entry list")
    .fill(Array.from({ length: 55 }, (_, i) => `Member ${i + 1}`).join("\n"));
  await page.getByLabel("Weighted selection", { exact: true }).check();
  await expect(page.locator(".appearance-rows li")).toHaveCount(10);
  await page
    .getByLabel("Entry list")
    .fill(
      Array.from(
        { length: 55 },
        (_, i) => `Member ${i + 1},${i === 0 ? 4 : i === 10 ? 2 : 1}`,
      ).join("\n"),
    );
  await page
    .getByRole("button", { name: "Public appearance next page" })
    .click();
  await expect(page.getByText("#0011", { exact: true })).toBeVisible();
  await expect(page.locator(".appearance-rows li")).toHaveCount(10);
  await expect(page.locator(".weight-value").first()).toHaveText("×2");
  await page
    .getByRole("button", { name: "Public appearance previous page" })
    .click();
  await expect(page.locator(".weight-value").first()).toHaveText("×4");
  await page
    .getByLabel("Public appearance rows per page", { exact: true })
    .selectOption("25");
  await expect(page.locator(".appearance-rows li")).toHaveCount(25);
  await expect(page.locator(".weight-value").nth(10)).toHaveText("×2");
  await page
    .getByLabel("Public appearance rows per page", { exact: true })
    .selectOption("50");
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(100);
  const settings = await page.locator(".composer-settings").boundingBox();
  expect(settings!.y).toBeGreaterThanOrEqual(22);
  expect(settings!.y).toBeLessThanOrEqual(26);
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Weighted community giveaway");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Entries have the public weights shown in the list. Each selected entry is removed completely. Participation is free. The organizer delivers the prize.",
    );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await expect(page.locator(".appearance-rows li")).toHaveCount(10);
  await expect(page.locator(".weight-value").first()).toHaveText("×4");
  await page.screenshot({
    path: "artifacts/weighted-review.png",
    fullPage: true,
  });
});
test("CSV weight mapping validates values and weighted mobile preview stays within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create");
  await page.getByRole("button", { name: "Import CSV or spreadsheet" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "weighted.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,Weight\nAlex,2\nSam,3\nJordan,1"),
  });
  await page.getByLabel("Entry column", { exact: true }).selectOption("0");
  await page.getByLabel("Weight column", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Add 3 entries" }).click();
  await expect(
    page.getByLabel("Weighted selection", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "Alex,2\nSam,3\nJordan,1",
  );
  await page.getByLabel("Entry list").fill("Alex,0\nSam,3\nJordan,1");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(page.locator("#entry-issues")).toContainText("whole numbers");
  await page.getByLabel("Entry list").fill("Alex,2\nSam,3\nJordan,1");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/weighted-mobile.png",
    fullPage: true,
  });
});
