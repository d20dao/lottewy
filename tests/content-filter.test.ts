import { afterEach, describe, expect, it, vi } from "vitest";
import { hash, type Draft } from "../shared/core";
import {
  assertPublicContent,
  LOCAL_CONTENT_POLICY,
  publicContentViolations,
} from "../worker/content-filter";
import { projection, review } from "../worker/jev";
import { database } from "./d1";

const draft: Draft = {
  title: "Community giveaway",
  description: "A free community draw.",
  rules: "Every entry has an equal chance.",
  entries: ["Synthetic Alice", "Synthetic Bob"],
  winners: 1,
  reserves: 0,
};
const env = { MODE: "production", JEV_MODE: "live", JEV_MODEL: "jev-test" };
afterEach(() => vi.unstubAllGlobals());

describe("bounded local public-text blacklist", () => {
  it("uses the package's broader English dictionary with whole-word boundaries", () => {
    expect(
      publicContentViolations({ ...draft, title: "This is crap" }),
    ).toContainEqual({ field: "title", category: "profanity" });
    expect(() =>
      assertPublicContent({ ...draft, title: "Scrapbook community" }),
    ).not.toThrow();
    expect(() =>
      assertPublicContent({ ...draft, title: "Crapé community" }),
    ).not.toThrow();
  });
  it.each([
    "FUCK",
    "f.u.c.k",
    "f u c k",
    "fu\u200bck",
    "ｆｕｃｋ",
    "fuçk",
    "5h!t",
    "shit!",
    "a$$h0le",
    "SİKTİR",
    "s1kt1r",
    "s.i.k.t.i.r",
    "orоspu",
    "OROSPU ÇOCUĞU",
    "AMK",
    "PİÇ",
    "p.i.ç",
  ])("rejects normalized or disguised profanity: %s", (title) => {
    expect(publicContentViolations({ ...draft, title })).toContainEqual({
      field: "title",
      category: "profanity",
    });
  });
  it.each([
    ["n1gg3r", "hate"],
    ["h.e.i.l h.i.t.l.e.r", "hate"],
    ["P0RN", "adult"],
    ["p.o.r.n.o", "adult"],
    ["pornografik", "adult"],
  ])("rejects listed slurs/adult terms: %s", (description, category) => {
    expect(publicContentViolations({ ...draft, description })).toContainEqual({
      field: "description",
      category,
    });
  });
  it.each([
    "Scunthorpe community",
    "Fukushima runners",
    "Dick Hancock and Nigel",
    "Sikander charity draw",
    "Classical analysis",
    "Eskişehir topluluğu",
    "All identities are welcome",
    "Adults welcome to the book club",
    "A pic of the prize",
  ])(
    "does not block ordinary names, embedded substrings or neutral context: %s",
    (title) => {
      expect(() => assertPublicContent({ ...draft, title })).not.toThrow();
    },
  );
  it("identifies each public field without echoing blocked content or changing the draft", () => {
    const input = {
      ...draft,
      title: "Fuck this",
      description: "pornography",
      rules: "heil hitler",
    };
    const before = structuredClone(input);
    expect(publicContentViolations(input)).toHaveLength(3);
    expect(() => assertPublicContent(input)).toThrow(
      "Title contains profanity",
    );
    expect(() => assertPublicContent(input)).toThrow(
      "Description contains an adult-content term",
    );
    expect(() => assertPublicContent(input)).toThrow(
      "Rules contains a hateful",
    );
    expect(() => assertPublicContent(input)).toThrow(
      "Your draft is preserved; nothing was saved.",
    );
    expect(input).toEqual(before);
  });
  it("does not scan private participant entries", () => {
    expect(() =>
      assertPublicContent({ ...draft, entries: ["fuck", "porn"] } as Draft),
    ).not.toThrow();
  });
});

describe("explicit admin-controlled JEV switch", () => {
  it("accepts local-only review only when explicitly disabled, without a JEV key or request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      review(draft, env, { jevEnabled: false }),
    ).resolves.toMatchObject({
      mode: "local",
      model: "local-filter",
      policy: LOCAL_CONTENT_POLICY,
      decision: "accepted",
      contentHash: hash(projection(draft)),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { jevEnabled: true }, { jevEnabled: "false" }])(
    "keeps JEV enabled for a non-explicit setting: %s",
    async (setting) => {
      await expect(
        review({ ...draft, jevEnabled: false } as Draft, env, setting as any),
      ).rejects.toThrow("JEV is not configured");
    },
  );
  it.each([true, false])(
    "always blocks local blacklist hits before any external request (JEV enabled: %s)",
    async (jevEnabled) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      await expect(
        review({ ...draft, rules: "siktir" }, env, { jevEnabled }),
      ).rejects.toThrow("Rules contains profanity");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
  it("keeps deterministic weighting-conflict protection when JEV is disabled", async () => {
    await expect(
      review({ ...draft, weights: [1, 10] }, env, { jevEnabled: false }),
    ).rejects.toThrow("different weights");
  });
  it("never turns a remote review failure into local acceptance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    await expect(
      review(draft, { ...env, JEV_API_KEY: "test-only" }),
    ).rejects.toThrow("JEV could not complete");
  });
  it("initializes the durable admin setting to enabled", () => {
    const db = database();
    try {
      expect(
        db.sqlite
          .prepare(
            "SELECT value,revision FROM app_settings WHERE key='jev_enabled'",
          )
          .get(),
      ).toMatchObject({ value: "true", revision: 0 });
    } finally {
      db.sqlite.close();
    }
  });
});
