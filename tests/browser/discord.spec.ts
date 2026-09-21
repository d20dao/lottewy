import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("Discord registration preserves a failed draft and stable ID, with usable mobile verification and review", async ({
  page,
}) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/discord-editor.html",
    `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><main style="padding:24px"><div id="root"></div></main><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';import {DiscordCreator} from '../src/Discord.tsx';import '../src/styles.css';
    window.calls=[];createRoot(document.getElementById('root')).render(React.createElement(DiscordCreator,{user:{address:'0x0000000000000000000000000000000000000001'},config:{discordConfigured:true},busy:false,run:f=>f(),notify:()=>{},onLogin:()=>{},mutate:async(...args)=>{window.calls.push(args);throw new Error('Connection lost. Please retry.');}}));
  </script></body></html>`,
  );
  const linkId = "0x" + "ab".repeat(32);
  await page.route("**/api/discord/links", (route) =>
    route.fulfill({
      json: [
        {
          id: linkId,
          guildName: "Community",
          channelName: "giveaways",
          verifiedAt: 1,
        },
      ],
    }),
  );
  await page.route("**/api/discord/challenge", (route) =>
    route.fulfill({
      json: {
        code: "12345678-abcd-abcd-abcd-123456789012",
        nonceRef: "0x" + "cd".repeat(32),
        expires: Math.floor(Date.now() / 1000) + 600,
        installUrl: "https://discord.com/oauth2/authorize",
      },
    }),
  );
  await page.route("**/api/discord/verification/*", (route) =>
    route.fulfill({ json: { linkId: null } }),
  );
  await page.route("**/api/discord/campaigns/*", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/artifacts/discord-editor.html");
  await page.getByRole("button", { name: "Verify another channel" }).click();
  await expect(page.getByLabel("One-time code")).toHaveValue(
    "12345678-abcd-abcd-abcd-123456789012",
  );
  await page
    .getByLabel("Verified channel", { exact: true })
    .selectOption(linkId);
  await page.getByLabel("Giveaway title").fill("Community giveaway");
  await page
    .getByLabel("Entry and prize rules")
    .fill("Free participation. One entry per Discord account.");
  await page.getByRole("button", { name: "Review registration" }).click();
  await expect(
    page.getByRole("heading", { name: "Review the announcement." }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Sign and publish registration" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Connection lost");
  const id = await page.evaluate(() => (window as any).calls[0][1]);
  await page
    .getByRole("button", { name: "Sign and publish registration" })
    .click();
  expect(await page.evaluate(() => (window as any).calls[1][1])).toBe(id);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `artifacts/discord-review-${width}.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.getByLabel("Giveaway title")).toHaveValue(
    "Community giveaway",
  );
  await page.getByRole("button", { name: "Review registration" }).click();
  await page
    .getByRole("button", { name: "Sign and publish registration" })
    .click();
  await expect(page.getByRole("alert")).toContainText("Connection lost");
  expect(await page.evaluate(() => (window as any).calls[0][1])).toBe(id);
});
