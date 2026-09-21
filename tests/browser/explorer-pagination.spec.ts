import { test, expect } from "@playwright/test";
test("explorer shows total, real numbered pages and a working page size", async ({
  page,
}) => {
  const fixtures = Array.from({ length: 24 }, (_, i) => ({
    id: `listed-fixture-${i}`,
    slug: `listed-fixture-${i}`,
    owner: "0x0000000000000000000000000000000000000001",
    revision: 1,
    status: "draft",
    listed: true,
    created: 1,
    entryCount: 6,
    manifest: { title: `Listed giveaway ${i + 1}` },
  }));
  await page.route("**/api/giveaways?*", (route) => {
    const url = new URL(route.request().url()),
      offset = Number(url.searchParams.get("offset") || 0),
      pageSize = Number(url.searchParams.get("limit") || 10);
    return route.fulfill({
      json: {
        items: fixtures.slice(offset, offset + pageSize),
        total: fixtures.length,
        pageSize,
        offset,
      },
    });
  });
  await page.goto("/explorer");
  const pager = page.getByRole("navigation", { name: "Giveaway pages" });
  await expect(pager).toBeVisible();
  await expect(pager.getByLabel("Giveaways per page")).toHaveValue("10");
  const first = await page
    .locator(".giveaway-row")
    .first()
    .getAttribute("href");
  await expect(page.locator(".giveaway-row")).toHaveCount(10);
  await pager.getByRole("button", { name: "Next giveaway page" }).click();
  await expect(
    pager.getByRole("button", { name: "Go to page 2" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".giveaway-row").first()).not.toHaveAttribute(
    "href",
    first!,
  );
  await pager.getByLabel("Giveaways per page").selectOption("20");
  await expect(
    pager.getByRole("button", { name: "Go to page 1" }),
  ).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: "artifacts/explorer-pagination.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
