import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("local Discord setup hands off to the deployed database without generating unusable codes", async ({
  page,
  request,
}) => {
  const config = await (await request.get("/api/config")).json();
  test.skip(!config.discordConfigured, "Requires local Discord configuration");
  expect(['https://testnet.lottewy.com','https://lottewy.com']).toContain(config.discordSetupOrigin);
  await page.goto("/create?mode=discord");
  await expect(
    page.getByRole("link", { name: /Continue on (testnet|Lottewy)/ }),
  ).toHaveAttribute("href", config.discordSetupOrigin+"/create?mode=discord");
  await expect(
    page.getByRole("button", { name: "Get verification code" }),
  ).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "artifacts/discord-handoff-" + width + ".png",
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("Discord registration preserves a failed draft and stable ID, with usable mobile verification and review", async ({
  page,
}) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/discord-editor.html",
    `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><main style="padding:24px"><div id="root"></div></main><script type="module">
    import React from 'react';import {createRoot} from 'react-dom/client';import {DiscordCreator} from '../src/Discord.tsx';import '../src/styles.css';
    window.calls=[];function Harness(){const[user,setUser]=React.useState(null);React.useEffect(()=>{const timer=setTimeout(()=>setUser({address:'0x0000000000000000000000000000000000000001'}),50);return()=>clearTimeout(timer);},[]);return React.createElement(DiscordCreator,{user,config:{discordConfigured:true,discordInstallUrl:'https://discord.com/oauth2/authorize?client_id=123456789012345678'},busy:false,run:f=>f(),notify:()=>{},onLogin:()=>{},mutate:async(...args)=>{window.calls.push(args);throw new Error('Connection lost. Please retry.');}});}createRoot(document.getElementById('root')).render(React.createElement(Harness));
  </script></body></html>`,
  );
  const linkId = "0x" + "ab".repeat(32);
  await page.route("**/api/discord/links/*/channels", (route) =>
    route.fulfill({ json: [{ id: "345678901234567890", name: "giveaways" }] }),
  );
  await page.route("**/api/discord/links/*/roles", (route) =>
    route.fulfill({
      json: [
        { id: "111111111111111111", name: "Community member" },
        { id: "222222222222222222", name: "Contributor" },
      ],
    }),
  );
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
  await page.clock.install();
  await page.goto("/artifacts/discord-editor.html");
  await page.getByRole("button", { name: "Connect another server" }).click();
  await expect(
    page.getByRole("link", { name: "Add bot to Discord" }),
  ).toBeVisible();
  await expect(page.getByLabel("One-time code")).toHaveValue(
    "12345678-abcd-abcd-abcd-123456789012",
  );
  await page.reload();
  await expect(page.getByLabel("One-time code")).toHaveValue(
    "12345678-abcd-abcd-abcd-123456789012",
  );
  await page.clock.fastForward(601000);
  await expect(
    page.getByText("This code expired. Get a new code to continue."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy verification command" }),
  ).toBeDisabled();
  await page
    .getByLabel("Verified server", { exact: true })
    .selectOption(linkId);
  await page
    .getByLabel("Giveaway channel", { exact: true })
    .selectOption("345678901234567890");
  await page.getByLabel("Limit to specific roles").check();
  await page.getByLabel("Contributor", { exact: true }).check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/discord-role-form-390.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Continue to giveaway details" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Set the giveaway details." }),
  ).toBeFocused();
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
  expect(
    await page.evaluate(() => (window as any).calls[0][3].roleIds),
  ).toEqual(["222222222222222222"]);
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
  const otherLink = "0x" + "ef".repeat(32);
  await page.route("**/api/discord/links", (route) =>
    route.fulfill({
      json: [
        { id: linkId, guildName: "First server", channelName: "" },
        { id: otherLink, guildName: "Second server", channelName: "" },
      ],
    }),
  );
  await page.route("**/api/discord/links/*/roles", (route) =>
    route.fulfill({
      json: route.request().url().includes(otherLink)
        ? [{ id: "222222222222222222", name: "Contributor" }]
        : Array.from({ length: 80 }, (_, i) => ({
            id: String(100000000000000000n + BigInt(i)),
            name: "Only A " + i,
          })),
    }),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Change server, channel or roles" })
    .click();
  await page.getByLabel("Find a role").fill("Only A 79");
  await page
    .getByLabel("Verified server", { exact: true })
    .selectOption(otherLink);
  await page
    .getByLabel("Giveaway channel", { exact: true })
    .selectOption("345678901234567890");
  await page.getByLabel("Limit to specific roles").check();
  await expect(page.getByLabel("Find a role")).toHaveCount(0);
  await expect(page.getByLabel("Contributor", { exact: true })).toBeVisible();
});
