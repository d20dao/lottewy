import { test, expect } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
test("injected test wallet: unfunded saves stop before signing and failed edits preserve the draft", async ({
  page,
}) => {
  // This test exercises real zero-balance rejection; widget behavior has its own harness.
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), turnstileSiteKey: null },
    });
  });
  const account = privateKeyToAccount(generatePrivateKey());
  let connected = false;
  let typedSignatures = 0;
  page.on("dialog", (dialog) =>
    dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss(),
  );
  await page.exposeFunction(
    "testWalletRequest",
    async ({ method, params = [] }: { method: string; params: any[] }) => {
      if (method === "eth_requestAccounts") {
        connected = true;
        return [account.address];
      }
      if (method === "eth_accounts") return connected ? [account.address] : [];
      if (method === "eth_chainId") return "0x4cef52";
      if (method === "personal_sign")
        return account.signMessage({ message: { raw: params[0] } });
      if (method === "eth_signTypedData_v4") {
        typedSignatures++;
        return account.signTypedData(JSON.parse(params[1]));
      }
      if (
        method === "wallet_switchEthereumChain" ||
        method === "wallet_requestPermissions"
      )
        return null;
      if (method === "eth_getBalance" || method === "eth_blockNumber")
        return "0x0";
      throw new Error("Unsupported test wallet method " + method);
    },
  );
  await page.addInitScript(() => {
    const w = window as any;
    const provider = {
      isMetaMask: true,
      request: (args: any) => w.testWalletRequest(args),
      on: () => {},
      removeListener: () => {},
    };
    w.ethereum = provider;
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "a074a261-d873-4022-8d71-e5f0f8c6b8ef",
              name: "E2E Test Wallet",
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
              rdns: "test.lottewy.wallet",
            },
            provider,
          },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  await page.goto("/create");
  await page.getByRole("button", { name: "Use sample list" }).click();
  await page
    .getByLabel("Entry and prize rules")
    .fill(
      "Every listed entry has an equal chance. Participation is free. The organizer delivers the prize.",
    );
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Signed UI save test");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "E2E Test Wallet" }).click();
  await page.screenshot({
    path: "artifacts/rainbowkit-signin.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign message" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: /Open account for/ }).click();
  await expect(page.locator(".wallet-avatar")).toBeVisible();
  expect(
    await page
      .locator('[role="dialog"] h1')
      .first()
      .evaluate((el) => getComputedStyle(el).letterSpacing),
  ).toMatch(/^(normal|0px)$/);
  await page.screenshot({
    path: "artifacts/rainbowkit-account-refined.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByLabel("Giveaway title", { exact: true })).toHaveValue(
    "Signed UI save test",
  );
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await page.getByRole("button", { name: "Sign and save" }).click();
  await expect(page.locator(".save-error")).toContainText("native USDC");
  expect(typedSignatures).toBe(0);
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  // The edit-recovery scenario uses a synthetic saved record; no funding bypass exists on the server.
  const fixture = {
    id: "editor-recovery",
    slug: "editor-recovery",
    owner: account.address.toLowerCase(),
    revision: 1,
    status: "draft",
    listed: false,
    private: {
      draft: {
        title: "Signed UI save test",
        description: "",
        rules:
          "Participation is free. Every entry has an equal chance. No prize.",
        entries: ["Alex Morgan", "Sam Taylor", "Jordan Lee"],
        winners: 1,
        reserves: 0,
      },
    },
  };
  await page.route("**/api/giveaways/editor-recovery/private", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/actions/challenge", (route) =>
    route.fulfill({
      json: {
        nonce: "synthetic-browser-nonce",
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        audience: "http://127.0.0.1:5173",
      },
    }),
  );
  await page.goto("/edit/editor-recovery");
  await expect(page.getByLabel("Entry list")).toContainText("Alex Morgan");
  await page
    .getByLabel("Giveaway title", { exact: true })
    .fill("Unsaved edited title");
  await page
    .getByLabel("Entry list")
    .fill(
      "Edited participant one\nEdited participant two\nEdited participant three",
    );
  await page.route("**/api/actions", async (route) => {
    if (route.request().postDataJSON().action.actionType === "edit")
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "Content review needs clarification. Explain the selection rules.",
        }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Review your giveaway" }).click();
  await page.getByRole("button", { name: "Sign and save" }).click();
  await expect(page.locator(".save-error")).toContainText(
    "Content review needs clarification",
  );
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary network error" }),
    }),
  );
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/me") && r.status() === 503,
    ),
    page.evaluate(() => window.dispatchEvent(new Event("focus"))),
  ]);
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open account for/ }),
  ).toBeVisible();
  await page.unroute("**/api/auth/me");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "One last look." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(page.getByLabel("Giveaway title", { exact: true })).toHaveValue(
    "Unsaved edited title",
  );
  await expect(page.getByLabel("Entry list")).toHaveValue(
    "Edited participant one\nEdited participant two\nEdited participant three",
  );
});
