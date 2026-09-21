import { test, expect, type Route } from "@playwright/test";
const record = {
  id: "polling-test",
  slug: "polling-test",
  owner: "0x0000000000000000000000000000000000000001",
  revision: 1,
  status: "pending",
  created: 1,
  commitment: `0x${"11".repeat(32)}`,
  review: { mode: "test", model: "test", policy: "test" },
  manifest: {
    version: 1,
    algorithm: "lottewy-fy-reject-v1",
    normalization: "nfc-trim-v1",
    masking: "strict-v2-en",
    id: "polling-test",
    owner: "0x0000000000000000000000000000000000000001",
    revision: 1,
    title: "Polling regression fixture",
    description: "Synthetic browser test.",
    rules: "Equal chances for every listed entry.",
    winners: 1,
    reserves: 0,
    entries: [
      { id: 1, label: "A***", commitment: `0x${"22".repeat(32)}` },
      { id: 2, label: "B***", commitment: `0x${"33".repeat(32)}` },
    ],
  },
};

test("active records sync immediately, serialize requests, pause hidden tabs and stop on completion", async ({
  page,
}) => {
  await page.clock.install();
  let posts = 0;
  let release: Route | undefined;
  await page.route("**/api/giveaways/polling-test", (route) =>
    route.fulfill({ json: record }),
  );
  await page.route("**/api/giveaways/polling-test/sync", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({});
    posts++;
    if (posts === 1) {
      release = route;
      return;
    }
    if (posts === 2) {
      await route.fulfill({
        status: 503,
        json: { error: "Temporary synthetic failure" },
      });
      return;
    }
    await route.fulfill({ json: { ...record, status: "completed" } });
  });
  await page.goto("/g/polling-test");
  await expect(
    page.getByRole("heading", { name: record.manifest.title }),
  ).toBeVisible();
  await expect.poll(() => posts).toBe(1);
  await page.clock.fastForward(20000);
  expect(posts).toBe(1);
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/polling-test/sync"),
    ),
    release!.fulfill({ json: record }),
  ]);
  await page.clock.fastForward(3100);
  await expect(
    page.getByText("Live updates interrupted. Retrying automatically."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: record.manifest.title }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(30000);
  expect(posts).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("heading", { name: "Completed", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(3);
  await page.clock.fastForward(30000);
  expect(posts).toBe(3);
});

for (const status of ["draft", "completed", "expired"]) {
  test(`${status} records do not start background reconciliation`, async ({
    page,
  }) => {
    await page.clock.install();
    let requests = 0;
    await page.route("**/api/giveaways/polling-test**", (route) => {
      requests++;
      return route.fulfill({ json: { ...record, status } });
    });
    await page.goto("/g/polling-test");
    await expect(
      page.getByRole("heading", { name: record.manifest.title }),
    ).toBeVisible();
    await page.clock.fastForward(30000);
    expect(requests).toBe(1);
  });
}

test("unlisted and hidden giveaways stay noindex; listed pages use their own canonical", async ({
  page,
}) => {
  for (const visibility of [undefined, false, true]) {
    await page.route("**/api/giveaways/polling-test", (route) =>
      route.fulfill({
        json: { ...record, status: "draft", listed: visibility },
      }),
    );
    await page.goto("/g/polling-test");
    await expect(page).toHaveTitle(`${record.manifest.title} — Lottewy`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      visibility ? "index,follow,max-image-preview:large" : "noindex,nofollow",
    );
    if (visibility)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        "https://lottewy.com/g/polling-test",
      );
    else await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await page.unroute("**/api/giveaways/polling-test");
  }
  await page.route("**/api/giveaways/polling-test", (route) =>
    route.fulfill({
      json: {
        id: record.id,
        slug: record.slug,
        commitment: record.commitment,
        hidden: true,
        listed: true,
        status: "draft",
      },
    }),
  );
  await page.goto("/g/polling-test");
  await expect(
    page.getByRole("heading", { name: "Content under review" }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex,nofollow",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});
