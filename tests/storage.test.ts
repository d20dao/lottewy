import { describe, it, expect } from "vitest";
import { database } from "./d1";
import { storeJson, loadJson } from "../worker/storage";
describe("bounded JSON storage", () => {
  it("round-trips Unicode across chunk boundaries without losing surrogate pairs", async () => {
    const db = database(),
      value = { text: "x".repeat(63987) + "😀".repeat(60000) };
    const stored = storeJson(db as any, "unicode", value);
    await db.batch(stored.statements);
    expect(await loadJson(db as any, stored.reference)).toEqual(value);
    for (const row of db.sqlite.prepare("SELECT value FROM json_chunks").all())
      expect(Buffer.byteLength(row.value as string)).toBeLessThan(200000);
    db.sqlite.prepare("DELETE FROM json_chunks WHERE part=1").run();
    await expect(loadJson(db as any, stored.reference)).rejects.toThrow(
      "incomplete",
    );
    db.sqlite.close();
  });
  it("keeps existing inline private records readable", async () => {
    const db = database();
    expect(await loadJson(db as any, '{"draft":{"title":"Existing"}}')).toEqual(
      { draft: { title: "Existing" } },
    );
    db.sqlite.close();
  });
});
