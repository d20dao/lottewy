import { test, expect } from "@playwright/test";
test("all six presentations reveal the same fixed winners and can be skipped", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/demo");
  await page
    .getByRole("button", { name: "Reveal instantly", exact: true })
    .click();
  const expected = await page.locator(".winner h2").allTextContents();
  for (const mode of [
    "slot",
    "wheel",
    "scramble",
    "countdown",
    "balloon",
    "scratch",
  ]) {
    await page.getByRole("button", { name: "Play again", exact: true }).click();
    const labels: Record<string, string> = {
      slot: "Slot reel",
      wheel: "Wheel",
      scramble: "Name scramble",
      countdown: "Countdown",
      balloon: "Balloon pop",
      scratch: "Scratch to reveal",
    };
    await page
      .getByRole("button", { name: `Reveal with ${labels[mode]}`, exact: true })
      .click();
    await expect(
      page.locator(".reveal-viewport.playing").first(),
    ).toBeVisible();
    if (mode === "balloon")
      for (let rank = 1; rank <= 3; rank++)
        await page
          .getByRole("button", {
            name: `Pop balloon to reveal winner ${rank}`,
            exact: true,
          })
          .click();
    if (mode === "scratch") {
      const box = (await page
        .locator(".scratch-card canvas")
        .first()
        .boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 25);
      await page.mouse.down();
      for (let y = 25; y < box.height - 15; y += 35) {
        await page.mouse.move(box.x + 20, box.y + y);
        await page.mouse.move(box.x + box.width - 20, box.y + y, { steps: 15 });
      }
      await page.mouse.up();
      await page
        .getByRole("button", {
          name: "Reveal winner 2 without scratching",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Reveal winner 3 without scratching",
          exact: true,
        })
        .click();
    }
    await page
      .getByRole("button", { name: "See all winners", exact: true })
      .click({ timeout: 5000 });
    await expect(
      page.getByRole("heading", { name: "Meet the winners." }),
    ).toBeVisible({ timeout: 5000 });
    expect(await page.locator(".winner h2").allTextContents()).toEqual(
      expected,
    );
  }
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page
    .getByRole("button", { name: "Reveal with Wheel", exact: true })
    .click();
  await page.getByRole("button", { name: "Reveal all now" }).click();
  expect(await page.locator(".winner h2").allTextContents()).toEqual(expected);
});
test("reduced motion reveals immediately and mobile controls remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo");
  await page.screenshot({
    path: "artifacts/reveal-cards-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reveal with Scratch to reveal", exact: true })
    .click();
  await expect(page.locator(".winner")).toHaveCount(3);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
