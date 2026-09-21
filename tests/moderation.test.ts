import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hash, type Draft } from "../shared/core";
import { projection, review, REVIEW_SIGNAL_KEYS } from "../worker/jev";

const draft: Draft = {
  title: "Community giveaway",
  description: "A free community draw.",
  rules: "Every entry has an equal chance. No payment is required.",
  entries: ["Synthetic Alice", "synthetic.bob@example.invalid"],
  winners: 1,
  reserves: 0,
};
const env = {
  MODE: "production",
  JEV_MODE: "live",
  JEV_MODEL: "jev-test",
  JEV_API_KEY: "test-only",
};
const answers = (overrides: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(REVIEW_SIGNAL_KEYS.map((key) => [key, { noul: 0.01 }])),
  ...overrides,
});
function respond(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body))),
  );
}
beforeEach(() => respond({ model: "jev-test", answers: answers() }));
afterEach(() => vi.unstubAllGlobals());

describe("public content moderation before saving", () => {
  it("requires all seven signals and sends only public metadata, not private entries", async () => {
    const result = await review(draft, env);
    expect(result).toMatchObject({
      mode: "live",
      decision: "accepted",
      policy: "lottewy-content-v5",
      contentHash: hash(projection(draft)),
    });
    const outgoing = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(Object.keys(outgoing.questions).sort()).toEqual([
      "adult",
      "conflict",
      "guarantee",
      "hate",
      "payment",
      "profanity",
      "secrets",
    ]);
    expect(outgoing.state).toMatchObject({
      title: draft.title,
      description: draft.description,
      rules: draft.rules,
      entryCount: 2,
    });
    expect(JSON.stringify(outgoing)).not.toContain("Synthetic Alice");
    expect(JSON.stringify(outgoing)).not.toContain("synthetic.bob");
    for (const question of Object.values(outgoing.questions) as any[])
      expect(question.instructions).toContain("untrusted content");
  });
  it.each([
    ["profanity", "Remove profanity"],
    ["hate", "Remove racist"],
    ["adult", "Remove explicit sexual"],
  ])(
    "rejects %s with actionable guidance and leaves the draft intact",
    async (signal, hint) => {
      const before = structuredClone(draft);
      respond({ answers: answers({ [signal]: { noul: 0.91 } }) });
      await expect(review(draft, env)).rejects.toThrow(hint);
      await expect(review(draft, env)).rejects.toThrow(
        "Your draft is preserved; nothing was saved.",
      );
      expect(draft).toEqual(before);
    },
  );
  it.each(REVIEW_SIGNAL_KEYS)(
    "fails closed when %s is missing",
    async (signal) => {
      const incomplete = answers();
      delete incomplete[signal];
      respond({ answers: incomplete });
      await expect(review(draft, env)).rejects.toThrow("Invalid JEV response");
    },
  );
  it.each([null, "0.01", -0.01, 1.01, true])(
    "rejects an invalid moderation score %s",
    async (noul) => {
      respond({ answers: answers({ hate: { noul } }) });
      await expect(review(draft, env)).rejects.toThrow("Invalid JEV response");
    },
  );
  it("requires clarification at the uncertainty boundary and changes at the high boundary", async () => {
    respond({ answers: answers({ profanity: { noul: 0.2 } }) });
    await expect(review(draft, env)).rejects.toThrow("needs clarification");
    respond({ answers: answers({ profanity: { noul: 0.8 } }) });
    await expect(review(draft, env)).rejects.toThrow("requires changes");
    respond({ answers: answers({ profanity: { noul: 0.199 } }) });
    await expect(review(draft, env)).resolves.toMatchObject({
      decision: "accepted",
    });
  });
  it.each([null, [], {}, { answers: {} }])(
    "fails closed on malformed response %s",
    async (response) => {
      respond(response);
      await expect(review(draft, env)).rejects.toThrow("Invalid JEV response");
    },
  );
  it("turns invalid JSON and upstream errors into draft-preserving messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid JSON")),
    );
    await expect(review(draft, env)).rejects.toThrow(
      "Your draft is preserved; nothing was saved.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("untrusted upstream body", { status: 503 }),
      ),
    );
    await expect(review(draft, env)).rejects.toThrow(
      "Your draft is preserved; nothing was saved.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private upstream details");
      }),
    );
    await expect(review(draft, env)).rejects.toThrow(
      "JEV is unavailable. Your draft is preserved.",
    );
  });
  it("does not allow the development adapter in production", async () => {
    await expect(
      review(draft, {
        ...env,
        JEV_MODE: "development",
        JEV_API_KEY: undefined,
      }),
    ).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
