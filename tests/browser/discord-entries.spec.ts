import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("organizer entries dialog paginates on mobile and drops private data on unmount", async ({
  page,
}) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/discord-entries.html",
    `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import DiscordEntries from '../src/components/DiscordEntries.tsx';import '../src/styles.css';import '../src/discord.css';const root=createRoot(document.getElementById('root'));window.disconnect=()=>root.render(React.createElement('p',{},'Disconnected'));root.render(React.createElement(DiscordEntries,{id:'11111111-1111-1111-1111-111111111111',count:41,address:'0x0000000000000000000000000000000000000001'}));</script></body></html>`,
  );
  await page.route("**/api/discord/campaigns/*/entries?*", (route) => {
    const params = new URL(route.request().url()).searchParams,
      p = Number(params.get("page")),
      size = Number(params.get("size"));
    return route.fulfill({
      json: {
        total: 41,
        status: "open",
        entries: Array.from(
          { length: Math.min(size, 41 - p * size) },
          (_, i) => ({
            userId: String(100000000000000000n + BigInt(p * size + i)),
            displayName: "Member " + (p * size + i),
            joinedAt: 100,
          }),
        ),
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/artifacts/discord-entries.html");
  await page.getByRole("button", { name: "View 41 Discord entries" }).click();
  const dialog = page.getByRole("dialog", { name: "Discord participants" });
  await expect(dialog.getByText("Member 0", { exact: true })).toBeVisible();
  await expect(dialog.locator("li")).toHaveCount(20);
  await dialog.getByRole("button", { name: "Next entry page" }).click();
  await expect(dialog.getByText("Member 20", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Next entry page" }).click();
  await expect(dialog.locator("li")).toHaveCount(1);
  await expect(dialog.getByText("Member 40", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/discord-entries-390.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.evaluate(() => (window as any).disconnect());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Member 40", { exact: true })).toHaveCount(0);
});
