import { test, expect } from "@playwright/test";
test("public copy, metadata and official infrastructure attribution remain consistent at narrow and desktop widths", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(
    "Lottewy | Verifiable Giveaways for Web3 Communities",
  );
  await expect(page.locator('meta[name="description"]')).not.toHaveAttribute(
    "content",
    /testnet|demo|—/i,
  );
  await expect(page.locator('a[href="/demo"]')).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Explore giveaways", exact: true }),
  ).toHaveAttribute("href", "/explorer");
  const arc = page.locator(".hero-arc-link");
  await expect(arc).toHaveAttribute("href", "https://www.arc.io/");
  await expect(page.locator("footer .footer-provider")).toHaveAttribute(
    "href",
    "https://d20dao.org",
  );
  expect((await arc.getAttribute("rel")) || "").not.toContain("nofollow");
  await expect(page.locator(".community-case")).toHaveCount(3);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width < 600)
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).not.toBeVisible();
    expect(
      (await page.locator(".hero-arc-logo").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(50);
    const padding = await arc.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingTop),
    );
    expect(padding).toBeGreaterThanOrEqual(18);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const brand = await page.locator("header .brand").boundingBox(),
      hero = await page.locator(".hero-copy").boundingBox();
    expect(Math.abs(brand!.x - hero!.x)).toBeLessThan(1);
    await page.screenshot({
      path: `artifacts/seo-branding-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/explorer");
  await expect(page).toHaveTitle("Public Giveaway Results | Lottewy");
  await expect(page.locator("#site-schema")).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://lottewy.com/explorer",
  );
  for (const width of [390, 1440, 1680]) {
    await page.setViewportSize({ width, height: 1000 });
    const brand = await page.locator("header .brand").boundingBox(),
      head = await page.locator(".page-head").boundingBox(),
      actions = await page.locator(".header-actions").boundingBox(),
      filters = await page.locator(".filters").boundingBox();
    expect(Math.abs(brand!.x - head!.x)).toBeLessThan(1);
    expect(
      Math.abs(actions!.x + actions!.width - filters!.x - filters!.width),
    ).toBeLessThan(1);
    await page.screenshot({
      path: `artifacts/explorer-aligned-${width}.png`,
      fullPage: true,
    });
  }
});
