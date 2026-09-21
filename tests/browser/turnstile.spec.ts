import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// Mount the real Editor without wallet signing or live anti-spam/JEV calls.
test.beforeAll(async () => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/turnstile-ui.html",
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '../src/Editor.tsx';
import '../src/styles.css';
import '../src/editor.css';
window.saveCalls=[];
function Fixture(){const [busy,setBusy]=React.useState(false);return React.createElement('main',{className:'workspace-main'},React.createElement(Editor,{
user:{address:'0x0000000000000000000000000000000000000001'},busy,
config:{jevConfigured:!new URLSearchParams(location.search).has('local-review'),jevEnabled:!new URLSearchParams(location.search).has('local-review'),turnstileSiteKey:new URLSearchParams(location.search).has('without-key')?null:'test-public-sitekey'},
run:async(fn)=>{setBusy(true);try{await fn()}finally{setBusy(false)}},
mutate:async(...args)=>{window.saveCalls.push(args);if(new URLSearchParams(location.search).has('content-rejection')&&window.saveCalls.length===1)throw Object.assign(new Error('Rules contains profanity or vulgar language. Remove the blocked wording and try again. Your draft is preserved; nothing was saved.'),{code:'CONTENT_REVIEW_REJECTED'});throw Object.assign(new Error('Your wallet needs native USDC on Arc Testnet before saving.'),{code:'ARC_USDC_REQUIRED'})},
notify:()=>{},onLogin:()=>{},refresh:()=>{}
}));}
createRoot(document.getElementById('fixture')).render(React.createElement(Fixture));
</script></body></html>`,
  );
});

test("content rejection turns save into an enabled edit action, then restores verified saving after correction", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).turnstile = {
      render: (_target: any, options: any) => {
        (window as any).widgetOptions = options;
        return "test-widget";
      },
      remove: () => {},
    };
  });
  await page.goto("/artifacts/turnstile-ui.html?content-rejection");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Content correction test");
  await page
    .getByLabel("Entry and prize rules")
    .fill("The original wording needs correction.");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).widgetOptions))
    .toBe(true);
  await page.evaluate(() =>
    (window as any).widgetOptions.callback("first-synthetic-token"),
  );
  await page
    .getByRole("button", { name: "Sign and save", exact: true })
    .click();
  const edit = page.getByRole("button", { name: "Edit giveaway", exact: true });
  await expect(edit).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Sign and save", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".save-error")).not.toContainText(
    "Your draft is still here.",
  );
  await edit.click();
  await expect(page.getByLabel("Giveaway title", { exact: true })).toHaveValue(
    "Content correction test",
  );
  await page
    .getByLabel("Entry and prize rules")
    .fill("Free entry. Every participant has an equal chance.");
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  const save = page.getByRole("button", { name: "Sign and save", exact: true });
  await expect(save).toBeDisabled();
  await page.evaluate(() =>
    (window as any).widgetOptions.callback("second-synthetic-token"),
  );
  await expect(save).toBeEnabled();
  await save.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).saveCalls.length))
    .toBe(2);
  expect(await page.evaluate(() => (window as any).saveCalls[1][3].rules)).toBe(
    "Free entry. Every participant has an equal chance.",
  );
});

test("save requires a fresh verification token and funding failure preserves the review", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.widgetRenders = 0;
    w.turnstile = {
      render: (target: HTMLElement, options: any) => {
        w.widgetOptions = options;
        w.widgetRenders++;
        target.textContent = "Synthetic verification widget";
        return String(w.widgetRenders);
      },
      remove: () => {},
    };
  });
  await page.goto("/artifacts/turnstile-ui.html");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Preserved anti-spam draft");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. The organizer delivers the prize.",
    );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  const save = page.getByRole("button", { name: "Sign and save", exact: true });
  await expect(save).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).widgetOptions?.action))
    .toBe("giveaway-save");
  await page.evaluate(() =>
    (window as any).widgetOptions["error-callback"]("110200"),
  );
  await expect(
    page.getByText(
      "Verification is not enabled for this site address. Your draft is still here.",
    ),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Retry verification" }).click();
  await page.evaluate(() =>
    (window as any).widgetOptions.callback("synthetic-token-one"),
  );
  await expect(save).toBeEnabled();
  await page.evaluate(() =>
    (window as any).widgetOptions["expired-callback"](),
  );
  await expect(save).toBeDisabled();
  await expect(
    page.getByText("Verification expired. Verify again before saving."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry verification" }).click();
  await page.evaluate(() =>
    (window as any).widgetOptions.callback("synthetic-token-two"),
  );
  await save.click();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Fund the connected wallet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Get testnet USDC" }),
  ).toHaveAttribute("href", "https://faucet.circle.com/");
  await expect(save).toBeDisabled();
  const calls = await page.evaluate(() => (window as any).saveCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0][3].turnstileToken).toBeUndefined();
  expect(calls[0][5]).toEqual({ turnstileToken: "synthetic-token-two" });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/turnstile-funding-test-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(page.getByLabel("Giveaway title", { exact: true })).toHaveValue(
    "Preserved anti-spam draft",
  );
  await expect(page.getByLabel("Entry list")).toContainText("Alex Morgan");
});

test("local blacklist review can save with JEV disabled and no development site key", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("challenges.cloudflare.com"))
      requests.push(request.url());
  });
  await page.goto("/artifacts/turnstile-ui.html?without-key&local-review");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Development draft");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. The organizer delivers the prize.",
    );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(
    page.getByRole("button", { name: "Sign and save", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Save verification" }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("blocked verification script fails closed and can be retried without losing review", async ({
  page,
}) => {
  let loads = 0;
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) => {
      loads++;
      return route.abort("failed");
    },
  );
  await page.goto("/artifacts/turnstile-ui.html");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Network retry draft");
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. The organizer delivers the prize.",
    );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await expect(
    page.getByText(
      "Verification could not load. Check your connection and try again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign and save", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry verification" }).click();
  await expect.poll(() => loads).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Network retry draft" }),
  ).toBeVisible();
});
