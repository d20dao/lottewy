import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "./d1";
const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getBalance: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => rpc,
}));
import {
  assertFunded,
  checkTurnstile,
  consumeReviewBudget,
} from "../worker/abuse";

const owner = "0x0000000000000000000000000000000000000001";
const other = "0x0000000000000000000000000000000000000002";
const env = {
  MODE: "production",
  APP_ORIGIN: "https://lottewy.example",
  RPC_URL: "https://rpc.example.invalid",
  TURNSTILE_SECRET_KEY: "test-only",
};
const valid = {
  success: true,
  action: "giveaway-save",
  hostname: "lottewy.example",
};
function response(value: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(value), { status })),
  );
}
beforeEach(() => {
  rpc.getChainId.mockReset().mockResolvedValue(5042002);
  rpc.getBalance.mockReset().mockResolvedValue(1n);
  response(valid);
});
afterEach(() => vi.unstubAllGlobals());

describe("Arc funding gate", () => {
  it("accepts even the smallest positive native balance on the configured network", async () => {
    await expect(assertFunded(env, owner)).resolves.toBeUndefined();
    expect(rpc.getBalance).toHaveBeenCalledWith({
      address: owner,
      blockTag: "latest",
    });
  });
  it("rejects zero native USDC with a machine-readable funding error", async () => {
    rpc.getBalance.mockResolvedValue(0n);
    await expect(assertFunded(env, owner)).rejects.toMatchObject({
      code: "ARC_USDC_REQUIRED",
      status: 400,
      message: expect.stringContaining("native USDC on Arc Testnet"),
    });
  });
  it("rejects the wrong network before reading a balance", async () => {
    rpc.getChainId.mockResolvedValue(1);
    await expect(assertFunded(env, owner)).rejects.toMatchObject({
      code: "FUNDING_CHECK_UNAVAILABLE",
      status: 503,
    });
    expect(rpc.getBalance).not.toHaveBeenCalled();
  });
  it.each([-1n, "1", null])(
    "rejects invalid balance responses: %s",
    async (balance) => {
      rpc.getBalance.mockResolvedValue(balance);
      await expect(assertFunded(env, owner)).rejects.toMatchObject({
        code: "FUNDING_CHECK_UNAVAILABLE",
      });
    },
  );
  it("fails closed and sanitizes network errors", async () => {
    rpc.getBalance.mockRejectedValue(new Error("untrusted provider internals"));
    await expect(assertFunded(env, owner)).rejects.toThrow(
      "Your draft is preserved",
    );
    await expect(assertFunded(env, owner)).rejects.not.toThrow(
      "untrusted provider internals",
    );
    await expect(assertFunded({ RPC_URL: "" }, owner)).rejects.toMatchObject({
      code: "FUNDING_CHECK_UNAVAILABLE",
    });
  });
});

describe("server-side Turnstile gate", () => {
  it("verifies the token server-side with the official endpoint and bounded timeout", async () => {
    await expect(
      checkTurnstile(env, "token", "192.0.2.1"),
    ).resolves.toBeUndefined();
    const [url, options] = (fetch as any).mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(options.method).toBe("POST");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.body.get("response")).toBe("token");
    expect(options.body.get("remoteip")).toBe("192.0.2.1");
    expect(options.body.get("secret")).toBe("test-only");
  });
  it.each([undefined, null, "", "  ", "x".repeat(2049), 42])(
    "rejects missing or invalid tokens without calling siteverify",
    async (token) => {
      await expect(checkTurnstile(env, token)).rejects.toMatchObject({
        code: "BOT_CHECK_REQUIRED",
        status: 400,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    { ...valid, success: false, "error-codes": ["timeout-or-duplicate"] },
    { ...valid, success: "true" },
    { ...valid, action: "other-action" },
    { ...valid, hostname: "other.example" },
    { success: true },
    null,
  ])(
    "rejects expired, reused, unbound or malformed verification results",
    async (value) => {
      response(value);
      await expect(checkTurnstile(env, "token")).rejects.toMatchObject({
        code: "BOT_CHECK_REQUIRED",
      });
    },
  );
  it("requires configuration outside development and enforces configured checks in development", async () => {
    await expect(
      checkTurnstile({ ...env, TURNSTILE_SECRET_KEY: undefined }, undefined),
    ).rejects.toMatchObject({ code: "BOT_CHECK_UNAVAILABLE", status: 503 });
    await expect(
      checkTurnstile(
        { ...env, MODE: "development", TURNSTILE_SECRET_KEY: undefined },
        undefined,
      ),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      checkTurnstile({ ...env, MODE: "development" }, undefined),
    ).rejects.toMatchObject({ code: "BOT_CHECK_REQUIRED" });
  });
  it("rejects unavailable and invalid JSON responses without exposing upstream data", async () => {
    response({ private: "upstream internals" }, 503);
    await expect(checkTurnstile(env, "token")).rejects.toMatchObject({
      code: "BOT_CHECK_UNAVAILABLE",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid JSON")),
    );
    await expect(checkTurnstile(env, "token")).rejects.toMatchObject({
      code: "BOT_CHECK_UNAVAILABLE",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream internals");
      }),
    );
    await expect(checkTurnstile(env, "token")).rejects.not.toThrow(
      "upstream internals",
    );
  });
  it("uses the origin hostname without its port and rejects invalid origin configuration", async () => {
    response({ ...valid, hostname: "127.0.0.1" });
    await expect(
      checkTurnstile({ ...env, APP_ORIGIN: "http://127.0.0.1:5173" }, "token"),
    ).resolves.toBeUndefined();
    await expect(
      checkTurnstile({ ...env, APP_ORIGIN: "file:///path" }, "token"),
    ).rejects.toMatchObject({ code: "BOT_CHECK_UNAVAILABLE" });
  });
});

describe("durable per-wallet review budget", () => {
  it("admits at most three concurrent attempts and rolls back both counters on denial", async () => {
    const db = database();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          consumeReviewBudget({ DB: db as any }, owner, 864000),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(3);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({
            code: "REVIEW_RATE_LIMIT",
            status: 429,
          });
      expect(
        db.sqlite
          .prepare("SELECT count FROM abuse_buckets ORDER BY bucket")
          .all(),
      ).toEqual([{ count: 3 }, { count: 3 }]);
    } finally {
      db.sqlite.close();
    }
  });
  it("allows a new short window without resetting the hourly budget and isolates wallets", async () => {
    const db = database();
    try {
      for (let i = 0; i < 3; i++)
        await consumeReviewBudget({ DB: db as any }, owner, 864000);
      await consumeReviewBudget({ DB: db as any }, owner, 864060);
      await consumeReviewBudget({ DB: db as any }, other, 864000);
      expect(
        db.sqlite
          .prepare(
            "SELECT count FROM abuse_buckets WHERE wallet=? AND bucket='hour:864000'",
          )
          .get(owner),
      ).toMatchObject({ count: 4 });
      expect(
        db.sqlite
          .prepare(
            "SELECT count FROM abuse_buckets WHERE wallet=? AND bucket='hour:864000'",
          )
          .get(other),
      ).toMatchObject({ count: 1 });
      expect(
        db.sqlite
          .prepare(
            "SELECT COUNT(*) AS total FROM abuse_buckets WHERE wallet=? AND expires<=864060",
          )
          .get(owner),
      ).toMatchObject({ total: 0 });
    } finally {
      db.sqlite.close();
    }
  });
  it("caps an hour's attempts at twenty even across different short windows", async () => {
    const db = database();
    try {
      for (let i = 0; i < 20; i++)
        await consumeReviewBudget({ DB: db as any }, owner, 864000 + i * 60);
      await expect(
        consumeReviewBudget({ DB: db as any }, owner, 865200),
      ).rejects.toMatchObject({ code: "REVIEW_RATE_LIMIT" });
      expect(
        db.sqlite
          .prepare("SELECT count FROM abuse_buckets WHERE bucket='hour:864000'")
          .get(),
      ).toMatchObject({ count: 20 });
      expect(
        db.sqlite
          .prepare(
            "SELECT count FROM abuse_buckets WHERE bucket='minute:865200'",
          )
          .get(),
      ).toBeUndefined();
      await expect(
        consumeReviewBudget({ DB: db as any }, owner, 867600),
      ).resolves.toBeUndefined();
    } finally {
      db.sqlite.close();
    }
  });
  it("fails closed if durable quota storage cannot be read", async () => {
    const db = {
      prepare: () => {
        throw new Error("internal database details");
      },
    };
    await expect(
      consumeReviewBudget({ DB: db as any }, owner),
    ).rejects.toMatchObject({ code: "REVIEW_LIMIT_UNAVAILABLE", status: 503 });
  });
});
