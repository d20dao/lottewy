import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("Explorer admin moderation requires a review reason and a signed action", async ({
  page,
}) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/explorer-admin.html",
    `<!doctype html><html><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import{Listing}from'../src/App.tsx';import '../src/styles.css';window.calls=[];createRoot(document.getElementById('root')).render(React.createElement(Listing,{mine:false,user:{address:'0x0000000000000000000000000000000000000001',admin:true},login:()=>{},refresh:0,busy:false,run:f=>f(),mutate:async(...args)=>{window.calls.push(args);}}));</script></body></html>`,
  );
  await page.route("**/api/giveaways?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "fixture",
            slug: "fixture",
            owner: "0x0000000000000000000000000000000000000001",
            revision: 2,
            status: "completed",
            created: 1,
            entryCount: 20,
            manifest: { title: "Review fixture" },
          },
        ],
        total: 1,
      },
    }),
  );
  await page.goto("/artifacts/explorer-admin.html");
  await page
    .getByRole("button", { name: "Hide Review fixture from Explorer" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Hide this giveaway?" });
  await expect(
    dialog.getByRole("button", { name: "Sign and hide" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Review reason")
    .fill("Suspicious published giveaway content.");
  await dialog.getByRole("button", { name: "Sign and hide" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).calls[0])).toEqual([
    "set-explorer-visibility",
    "fixture",
    2,
    { hidden: true, reason: "Suspicious published giveaway content." },
  ]);
});
