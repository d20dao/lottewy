import { test, expect } from "@playwright/test";
import giveaway from "../../docs/testnet-v2-public-giveaway.json" with { type: "json" };

test("agent results use the separate API and expose no website mutation controls", async ({
  page,
}) => {
  let websiteGiveawayCalls = 0,
    agentCalls = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/giveaways/"))
      websiteGiveawayCalls++;
  });
  await page.route(
    `https://api.lottewy.com/v1/giveaways/${giveaway.id}`,
    (route) => {
      agentCalls++;
      return route.fulfill({
        json: { id: giveaway.id, status: "completed", giveaway },
      });
    },
  );
  await page.goto(`/agent/${giveaway.id}`);
  await expect(
    page.getByRole("heading", { name: giveaway.manifest.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Report content", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Organizer export", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reveal instantly", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download proof JSON", exact: true }),
  ).toBeVisible();
  expect(agentCalls).toBeGreaterThan(0);
  expect(websiteGiveawayCalls).toBe(0);
});
