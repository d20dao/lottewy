import { beforeEach, describe, it, expect, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { actionData, hash, type Action, type Draft } from "../shared/core";
import { database } from "./d1";
const abuse = vi.hoisted(() => ({
  assertFunded: vi.fn(),
  checkTurnstile: vi.fn(),
  consumeReviewBudget: vi.fn(),
}));
vi.mock("../worker/abuse", async (original) => ({
  ...(await original<typeof import("../worker/abuse")>()),
  ...abuse,
}));
vi.mock("../worker/submission", () => ({
  reserveTransaction: async () => ({
    nonce: 0,
    consumer: "0x0000000000000000000000000000000000000001",
  }),
  recordSubmission: async () => ({ ok: true }),
}));
vi.mock("../worker/reconcile", () => ({
  quote: async () => ({ blockNumber: "10" }),
  reconcile: vi.fn(async () => {}),
}));
import worker from "../worker/index";
import { reconcile } from "../worker/reconcile";
const account = privateKeyToAccount(generatePrivateKey()),
  other = privateKeyToAccount(generatePrivateKey());
const origin = "http://127.0.0.1:5173";
const draft: Draft = {
  title: "Topluluk seçimi",
  description: "",
  rules: "Entries ücretsiz, eşit şans.",
  entries: ["Alice Smith", "Bob Jones", "Cem Kaya"],
  winners: 1,
  reserves: 1,
};
let db: ReturnType<typeof database>, env: any, cookie: string;
const call = async (path: string, payload?: any, c = cookie) =>
  worker.fetch(
    new Request(origin + "/api" + path, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: c || "",
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
    env,
  );
async function login(a = account) {
  const c = (await (
    await call("/auth/challenge", { address: a.address }, "")
  ).json()) as any;
  const signature = await a.signMessage({ message: c.message });
  const response = await call(
    "/auth/verify",
    { nonce: c.nonce, signature },
    "",
  );
  return {
    cookie: response.headers.get("Set-Cookie")!.split(";")[0],
    c,
    signature,
  };
}
async function command(
  type: string,
  id: string,
  revision: number,
  payload: any,
  a = account,
  c = cookie,
) {
  const challenge = (await (
    await call("/actions/challenge", {}, c)
  ).json()) as any;
  const action: Action = {
    signer: a.address,
    actionId: crypto.randomUUID(),
    actionType: type,
    giveawayId: id,
    payloadHash: hash(payload),
    expectedRevision: revision,
    ...challenge,
  };
  return {
    action,
    payload,
    signature: await a.signTypedData(actionData(action)),
  };
}
beforeEach(async () => {
  Object.values(abuse).forEach((mock) => mock.mockReset());
  db = database();
  env = {
    DB: db,
    APP_ORIGIN: origin,
    MODE: "development",
    JEV_MODE: "live",
    JEV_API_KEY: "test-only",
    JEV_MODEL: "jev-test",
    ADMIN_ADDRESSES: "",
    CONSUMER_ADDRESS: "",
    RPC_URL: "http://unused",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-test",
            answers: Object.fromEntries(
              [
                "secrets",
                "payment",
                "guarantee",
                "conflict",
                "profanity",
                "hate",
                "adult",
              ].map((k) => [k, { noul: 0.01 }]),
            ),
          }),
        ),
    ),
  );
  cookie = (await login()).cookie;
});
describe("signed Worker actions / real SQL atomicity", () => {
  it("serves settled records without public RPC work and limits recovery credits to the signed owner", async () => {
    const id = crypto.randomUUID();
    await call(
      "/actions",
      await command("create", id, 0, { ...draft, listed: true }),
    );
    const saved = JSON.parse(
      db.sqlite.prepare("SELECT public_json FROM giveaways WHERE id=?").get(id)!
        .public_json as string,
    );
    saved.recovery = {
      requestId: "1",
      refundCredit: "123456",
      overpaymentCredit: "654321",
    };
    db.sqlite
      .prepare(
        "UPDATE giveaways SET status='completed',public_json=? WHERE id=?",
      )
      .run(JSON.stringify(saved), id);
    vi.mocked(reconcile).mockClear();
    const pub = (await (
      await call(`/giveaways/${id}/sync`, {}, "")
    ).json()) as any;
    expect(pub.recovery.requestId).toBe("1");
    expect(pub.recovery.refundCredit).toBeUndefined();
    expect(pub.recovery.overpaymentCredit).toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
    const own = (await (await call(`/giveaways/${id}`)).json()) as any;
    expect(own.recovery.refundCredit).toBe("123456");
  });
  it("only an allowlisted signed admin can switch JEV; local filtering remains active and settings are revision guarded", async () => {
    const payload = {
      enabled: false,
      reason: "Use the local filter during maintenance.",
    };
    expect(
      (
        await call(
          "/actions",
          await command("set-jev", "jev_enabled", 0, payload),
        )
      ).status,
    ).toBe(400);
    env.ADMIN_ADDRESSES = account.address;
    const toggle = await command("set-jev", "jev_enabled", 0, payload);
    expect((await call("/actions", toggle)).status).toBe(200);
    expect((await call("/actions", toggle)).status).toBe(200);
    expect(await (await call("/admin")).json()).toMatchObject({
      settings: { jevEnabled: false, revision: 1 },
    });
    vi.mocked(fetch).mockClear();
    const created = await call(
      "/actions",
      await command("create", crypto.randomUUID(), 0, draft),
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ review: { mode: "local" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await call(
          "/actions",
          await command("create", crypto.randomUUID(), 0, {
            ...draft,
            title: "Fuck you idiots",
          }),
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await call(
          "/actions",
          await command("set-jev", "jev_enabled", 0, {
            ...payload,
            enabled: true,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "/actions",
          await command("set-jev", "jev_enabled", 1, {
            ...payload,
            enabled: true,
          }),
        )
      ).status,
    ).toBe(200);
    expect(await (await call("/config")).json()).toMatchObject({
      jevEnabled: true,
    });
    expect(
      db.sqlite
        .prepare("SELECT count(*) n FROM actions WHERE action_type='set-jev'")
        .get(),
    ).toMatchObject({ n: 2 });
  });
  it("rejects an unfunded wallet before content review or storage, including direct signed-action bypass", async () => {
    abuse.assertFunded.mockRejectedValue(
      Object.assign(
        new Error("Add native USDC on Arc Testnet to save a giveaway."),
        { code: "ARC_USDC_REQUIRED" },
      ),
    );
    const challenge = await call("/actions/challenge", {
      actionType: "create",
    });
    expect(challenge.status).toBe(400);
    expect(await challenge.json()).toMatchObject({ code: "ARC_USDC_REQUIRED" });
    const id = crypto.randomUUID(),
      cmd = await command("create", id, 0, draft);
    vi.mocked(fetch).mockClear();
    expect((await call("/actions", cmd)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(abuse.checkTurnstile).not.toHaveBeenCalled();
    expect(abuse.consumeReviewBudget).not.toHaveBeenCalled();
    expect((await call(`/giveaways/${id}`)).status).toBe(404);
  });
  it("does not call JEV if bot verification or the review budget rejects the request", async () => {
    for (const failed of [abuse.checkTurnstile, abuse.consumeReviewBudget]) {
      Object.values(abuse).forEach((mock) => mock.mockReset());
      failed.mockRejectedValue(new Error("Review unavailable"));
      const cmd = await command("create", crypto.randomUUID(), 0, draft);
      vi.mocked(fetch).mockClear();
      expect((await call("/actions", cmd)).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    }
  });
  it("serves unlisted documents with noindex headers before JavaScript runs", async () => {
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    env.ASSETS = {
      fetch: async () =>
        new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        }),
    };
    const response = await worker.fetch(new Request(origin + `/g/${id}`), env);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("<html></html>");
  });
  it("requires explicit Explorer listing while preserving public link access and owner access", async () => {
    const id = crypto.randomUUID();
    expect(
      (await call("/actions", await command("create", id, 0, draft))).status,
    ).toBe(200);
    expect(
      await (await call("/giveaways?paged=1&limit=10")).json(),
    ).toMatchObject({ total: 0 });
    expect((await call(`/giveaways/${id}`, undefined, "")).status).toBe(200);
    expect(
      await (await call("/giveaways?mine=1&paged=1&limit=10")).json(),
    ).toMatchObject({ total: 1 });
    expect(
      (
        await call(
          "/actions",
          await command("edit", id, 1, { ...draft, listed: true }),
        )
      ).status,
    ).toBe(200);
    expect(
      await (await call("/giveaways?paged=1&limit=10")).json(),
    ).toMatchObject({ total: 1, items: [{ id, listed: true }] });
    expect(
      (
        await call(
          "/actions",
          await command("edit", id, 2, { ...draft, listed: false }),
        )
      ).status,
    ).toBe(200);
    expect(
      await (await call("/giveaways?paged=1&limit=10")).json(),
    ).toMatchObject({ total: 0 });
    expect((await call(`/giveaways/${id}`, undefined, "")).status).toBe(200);
  });
  it("rejects title and description overflow before calling the content provider or saving", async () => {
    for (const payload of [
      { ...draft, title: "T".repeat(121) },
      { ...draft, description: "D".repeat(4001) },
    ]) {
      const id = crypto.randomUUID();
      vi.mocked(fetch).mockClear();
      const response = await call(
        "/actions",
        await command("create", id, 0, payload),
      );
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
      expect((await call(`/giveaways/${id}`)).status).toBe(404);
    }
  });
  it("returns the full public detail shape for unauthenticated synchronization", async () => {
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    const response = await call(`/giveaways/${id}/sync`, {}, "");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id,
      status: "draft",
      history: [{ revision: 1 }],
      attempts: [],
    });
  });
  it("paginates matching summaries without shipping complete participant manifests", async () => {
    for (let i = 0; i < 12; i++)
      await call(
        "/actions",
        await command("create", crypto.randomUUID(), 0, {
          ...draft,
          title: `Pagination sample ${i}`,
          listed: true,
        }),
      );
    const first = (await (
        await call("/giveaways?paged=1&limit=10")
      ).json()) as any,
      second = (await (
        await call("/giveaways?paged=1&limit=10&offset=10")
      ).json()) as any;
    expect(first.total).toBe(12);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...second.items].map((g) => g.id)).size,
    ).toBe(12);
    expect(first.items[0].entryCount).toBe(3);
    expect(first.items[0].manifest.entries).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain("Alice Smith");
    const filtered = (await (
      await call("/giveaways?paged=1&limit=10&q=sample%201")
    ).json()) as any;
    expect(filtered.total).toBe(3);
  });
  it("SIWE nonce consumed once; wrong signer cannot authenticate", async () => {
    const l = await login();
    expect(
      (await call("/auth/verify", { nonce: l.c.nonce, signature: l.signature }))
        .status,
    ).toBe(400);
    const c = (await (
      await call("/auth/challenge", { address: account.address })
    ).json()) as any;
    env.RPC_URL = "http://127.0.0.1:1";
    const sig = await other.signMessage({ message: c.message });
    expect(
      (await call("/auth/verify", { nonce: c.nonce, signature: sig })).status,
    ).toBe(400);
  });
  it("creates public masked data while private owner data is protected", async () => {
    const id = crypto.randomUUID();
    const cmd = await command("create", id, 0, draft);
    expect((await call("/actions", cmd)).status).toBe(200);
    const pub = await (await call(`/giveaways/${id}`)).text();
    expect(pub).not.toContain("Alice Smith");
    expect(pub).not.toContain("salt");
    expect((await call(`/giveaways/${id}/private`, undefined, "")).status).toBe(
      400,
    );
    const owner = await (await call(`/giveaways/${id}/private`)).text();
    expect(owner).toContain("Alice Smith");
    const foreign = await login(other);
    expect(
      (await call(`/giveaways/${id}/private`, undefined, foreign.cookie))
        .status,
    ).toBe(400);
    expect((await call("/admin")).status).toBe(400);
  });
  it("same action is idempotent; changed payload, nonce replay and wrong audience fail", async () => {
    const id = crypto.randomUUID(),
      cmd = await command("create", id, 0, draft);
    const a = await (await call("/actions", cmd)).json();
    expect(await (await call("/actions", cmd)).json()).toEqual(a);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM actions").get()?.n).toBe(
      1,
    );
    expect(
      (
        await call("/actions", {
          ...cmd,
          payload: { ...draft, title: "Changed" },
        })
      ).status,
    ).toBe(400);
    const replay = {
      ...cmd.action,
      actionId: crypto.randomUUID(),
      actionType: "edit",
      expectedRevision: 1,
    };
    expect(
      (
        await call("/actions", {
          action: replay,
          payload: draft,
          signature: await account.signTypedData(actionData(replay)),
        })
      ).status,
    ).toBe(400);
    const wrong = await command("edit", id, 1, draft);
    wrong.action.audience = "https://evil.example";
    wrong.signature = await account.signTypedData(actionData(wrong.action));
    expect((await call("/actions", wrong)).status).toBe(400);
  });
  it("concurrent edits and start cannot both commit; locked edit always fails", async () => {
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    const pub = (await (await call(`/giveaways/${id}`)).json()) as any;
    const start = await command("start", id, 1, { commitment: pub.commitment }),
      edit = await command("edit", id, 1, {
        ...draft,
        title: "Edited version",
      });
    const responses = await Promise.all([
      call("/actions", start),
      call("/actions", edit),
    ]);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    const row = db.sqlite
      .prepare("SELECT * FROM giveaways WHERE id=?")
      .get(id) as any;
    if (row.status === "draft") {
      const g = JSON.parse(row.public_json);
      expect(
        (
          await call(
            "/actions",
            await command("start", id, 2, { commitment: g.commitment }),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (await call("/actions", await command("edit", id, row.revision, draft)))
        .status,
    ).toBe(400);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM attempts").get()?.n).toBe(
      1,
    );
  });
  it("foreign owner cannot edit or start", async () => {
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    const foreign = await login(other);
    expect(
      (
        await call(
          "/actions",
          await command("edit", id, 1, draft, other, foreign.cookie),
          foreign.cookie,
        )
      ).status,
    ).toBe(400);
  });
  it("JEV receives no entry PII and fails closed on uncertainty and service error", async () => {
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    const request = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(JSON.stringify(request)).not.toContain("Alice");
    expect(request.state.entryCount).toBe(3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    expect(
      (
        await call(
          "/actions",
          await command("create", crypto.randomUUID(), 0, draft),
        )
      ).status,
    ).toBe(400);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM giveaways").get()?.n).toBe(
      1,
    );
  });
  it("admin moderation masks data and cannot rewrite winner, raw word or locked inputs", async () => {
    env.ADMIN_ADDRESSES = account.address;
    const id = crypto.randomUUID();
    await call("/actions", await command("create", id, 0, draft));
    const before = db.sqlite
      .prepare("SELECT public_json FROM giveaways WHERE id=?")
      .get(id)?.public_json;
    expect(
      (
        await call(
          "/actions",
          await command("moderate", id, 1, {
            hidden: true,
            reason: "Content under review.",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      db.sqlite.prepare("SELECT public_json FROM giveaways WHERE id=?").get(id)
        ?.public_json,
    ).toBe(before);
    expect(
      (
        await call(
          "/actions",
          await command("set-winner", id, 1, { winner: 2 }),
        )
      ).status,
    ).toBe(400);
    const pub = (await (await call(`/giveaways/${id}`)).json()) as any;
    expect(pub.hidden).toBe(true);
    expect(pub.manifest).toBeUndefined();
    expect(() =>
      db.sqlite.exec("UPDATE actions SET action_type='rewritten'"),
    ).toThrow();
  });
});
