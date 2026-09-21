import { test, expect, type Page } from "@playwright/test";
import { makeManifest, select } from "../../shared/core";
const owner = "0x0000000000000000000000000000000000000001";
const word = `0x${"42".repeat(32)}` as const;
async function fixture(page: Page, count: number) {
  const id = "reveal-round-fixture";
  const built = makeManifest(
    {
      title: "Winner rounds fixture",
      description: "",
      rules: "Free participation with equal chances.",
      entries: Array.from({ length: 30 }, (_, i) => `Participant ${i + 1}`),
      winners: count,
      reserves: 0,
    },
    id,
    owner,
    1,
  );
  const record = {
    id,
    slug: id,
    owner,
    revision: 1,
    status: "completed",
    created: 1,
    listed: true,
    ...built,
    review: { mode: "live", model: "fixture", policy: "fixture" },
    evidence: { word },
  };
  await page.route("**/api/giveaways/" + id, (route) =>
    route.fulfill({ json: record }),
  );
  await page.goto("/g/" + id);
  return select(built.manifest, word, built.commitment).winners;
}
test("20 winners play in four bounded rounds of five, preserving recorded order", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const expected = await fixture(page, 20);

  await page
    .getByRole("button", { name: "Reveal with Slot reel", exact: true })
    .click();
  for (let round = 0; round < 4; round++) {
    await expect(
      page.getByRole("heading", { name: `Round ${round + 1} of 4` }),
    ).toBeVisible();
    await expect(page.locator(".slot-track")).toHaveCount(5);
    expect(
      await page
        .locator(".reveal-batch-grid")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(5);
    if (round === 0)
      await page.screenshot({
        path: "artifacts/reveal-round-five-columns.png",
        fullPage: true,
      });
    await page.clock.runFor(1850);
    await expect(page.locator(".round-winner-result")).toHaveCount(5);
    expect(
      await page.locator(".round-winner-result small").allTextContents(),
    ).toEqual(
      expected
        .slice(round * 5, round * 5 + 5)
        .map((id) => `Entry #${String(id).padStart(4, "0")}`),
    );
    await page
      .getByRole("button", {
        name: round === 3 ? "See all winners" : "Reveal next 5 winners",
        exact: true,
      })
      .click();
  }
  await expect(page.locator(".winner")).toHaveCount(20);
});
test("countdown displays 3, 2, 1 inside stable cards before revealing names", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await fixture(page, 3);
  await page
    .getByRole("button", { name: "Reveal with Countdown", exact: true })
    .click();
  const countdown = page.locator(".reveal-countdown");
  await expect(countdown).toHaveText(["3", "3", "3"]);
  const before = await page
    .locator(".reveal-winner-column")
    .first()
    .boundingBox();
  await page.clock.runFor(1000);
  await expect(countdown).toHaveText(["2", "2", "2"]);
  await page.clock.runFor(1000);
  await expect(countdown).toHaveText(["1", "1", "1"]);
  await page.clock.runFor(1050);
  await expect(page.locator(".round-winner-result")).toHaveCount(3);
  await expect(page.getByText("Revealed", { exact: true })).toHaveCount(0);
  const after = await page
    .locator(".reveal-winner-column")
    .first()
    .boundingBox();
  expect(after).toEqual(before);
});
test("scratch rounds have keyboard alternatives, a partial final round and a skip-all action", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await fixture(page, 7);

  await page
    .getByRole("button", { name: "Reveal with Scratch to reveal", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveCount(5);
  for (let rank = 1; rank <= 5; rank++)
    await page
      .getByRole("button", {
        name: `Reveal winner ${rank} without scratching`,
        exact: true,
      })
      .click();
  await page
    .getByRole("button", { name: "Reveal next 2 winners", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/reveal-round-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reveal all now", exact: true })
    .click();
  await expect(page.locator(".winner")).toHaveCount(7);
});
test("reduced motion bypasses rounds and the incomplete final result row keeps the same card size", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 5);
  await page
    .getByRole("button", { name: "Reveal with Wheel", exact: true })
    .click();
  await expect(page.locator(".winner")).toHaveCount(5);
  await expect(page.locator(".reveal-wheel")).toHaveCount(0);
  const boxes = await page.locator(".winner").evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top };
    }),
  );
  expect(boxes[4].top).toBeGreaterThan(boxes[0].top);
  for (const box of boxes) {
    expect(Math.abs(box.width - boxes[0].width)).toBeLessThan(1);
    expect(Math.abs(box.height - boxes[0].height)).toBeLessThan(1);
  }
  await page.screenshot({
    path: "artifacts/winner-cards-equal-size.png",
    fullPage: true,
  });
});
