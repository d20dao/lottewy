import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
test("new giveaway retries and page reload preserve one logical giveaway ID", async ({
  page,
}) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/save-retry.html",
    `<!doctype html><html><body><div id="root"></div><script type="module">
 import React from 'react';import{createRoot}from'react-dom/client';import Editor from '../src/Editor.tsx';import '../src/styles.css';import '../src/editor.css';window.calls=[];createRoot(document.getElementById('root')).render(React.createElement(Editor,{user:{address:'0x0000000000000000000000000000000000000001'},busy:false,config:{jevConfigured:true,jevEnabled:true},run:f=>f(),mutate:async(...args)=>{window.calls.push(args);throw new Error('Connection lost after server accepted the request.');},notify:()=>{},onLogin:()=>{},refresh:()=>{}}));
 </script></body></html>`,
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/artifacts/save-retry.html");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Retry fixture");
  await page
    .getByLabel("Entry and prize rules")
    .fill("Free entry with equal chances.");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await page
    .getByRole("button", { name: "Sign and save", exact: true })
    .click();
  await expect(page.locator(".save-error")).toContainText("Connection lost");
  const id = await page.evaluate(() => (window as any).calls[0][1]);
  await page
    .getByRole("button", { name: "Sign and save", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(2);
  expect(await page.evaluate(() => (window as any).calls[1][1])).toBe(id);
  await page.reload();
  await page
    .getByRole("button", { name: "Sign and save", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(1);
  expect(await page.evaluate(() => (window as any).calls[0][1])).toBe(id);
  await expect(page.locator(".save-error")).toContainText("Connection lost");
  const acceptedDraft = await page.evaluate(() => (window as any).calls[0][3]);
  await page.route(`**/api/giveaways/${id}/private`, (route) =>
    route.fulfill({
      json: {
        id,
        slug: id,
        revision: 1,
        status: "draft",
        private: { draft: acceptedDraft },
      },
    }),
  );
  await page
    .getByRole("button", { name: "Back to editing", exact: true })
    .click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Edited after accepted response was lost");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await page
    .getByRole("button", { name: "Sign and save", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as any).calls[1].slice(0, 3)),
  ).toEqual(["edit", id, 1]);
});
