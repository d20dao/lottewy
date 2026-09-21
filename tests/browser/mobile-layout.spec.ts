import { test, expect } from "@playwright/test";

for (const width of [320, 390, 430]) {
  test(`mobile ${width}px footer, filters and official wallet controls remain readable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    const logo = (await footer.locator(".footer-brand").boundingBox())!;
    const tagline = (await footer.locator(".footer-identity p").boundingBox())!;
    const provider = (await footer.locator(".footer-provider").boundingBox())!;
    expect(tagline.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    expect(provider.y).toBeGreaterThanOrEqual(tagline.y + tagline.height);
    await footer.screenshot({ path: `artifacts/mobile-footer-${width}.png` });
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    const close = page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    await expect
      .poll(async () => {
        const box = await close.boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width;
      })
      .toBe(true);
    await close.click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.goto("/explorer");
    await expect(
      page.getByRole("combobox", { name: "Status", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/mobile-explorer-${width}.png`,
      fullPage: true,
    });
  });
}

test("narrow review handles three-digit winner counts and long public wallets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/create");
  await page
    .getByLabel("Entry list")
    .fill(
      Array.from({ length: 200 }, (_, index) =>
        index === 0
          ? "0x0000000000000000000000000000000000000001"
          : `Community participant ${index + 1}`,
      ).join("\n"),
    );
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Large community giveaway");
  await page.getByLabel("Winners", { exact: true }).fill("100");
  await page.getByLabel("Alternates", { exact: true }).fill("100");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. The organizer will deliver the prize.",
    );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await expect(page.locator(".review-counts")).toContainText("100 winners");
  await expect(page.locator(".review-counts")).toContainText("100 alternates");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("true mobile wallet layout keeps wallet names and close control separate", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  const mask = (await dialog
    .getByText("MetaMask", { exact: true })
    .boundingBox())!;
  const connect = (await dialog
    .getByText("WalletConnect", { exact: true })
    .boundingBox())!;
  expect(
    mask.x + mask.width <= connect.x || mask.y + mask.height <= connect.y,
  ).toBe(true);
  const close = (await dialog
    .getByRole("button", { name: "Close", exact: true })
    .boundingBox())!;
  expect(close.x).toBeGreaterThanOrEqual(0);
  expect(close.x + close.width).toBeLessThanOrEqual(320);
  await context.close();
});
