import { it, expect, vi, afterEach } from "vitest";
import { signedAction, clearPendingActions } from "../src/api";
const owner = "0x0000000000000000000000000000000000000001";
afterEach(() => {
  clearPendingActions(owner);
  vi.unstubAllGlobals();
});
it("reuses the signed operation after a lost response instead of signing and creating another", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) || null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    get length() {
      return storage.size;
    },
    key: (i: number) => [...storage.keys()][i],
  });
  const calls: any[] = [];
  let fail = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: any) => {
      const body = JSON.parse(options.body);
      if (path.endsWith("/challenge"))
        return new Response(
          JSON.stringify({
            nonce: crypto.randomUUID(),
            issuedAt: 1,
            expiresAt: 9999999999,
            audience: "http://localhost",
          }),
        );
      calls.push(body);
      if (fail) {
        fail = false;
        throw new TypeError("Response lost");
      }
      return new Response(JSON.stringify({ id: "stable", slug: "stable" }));
    }),
  );
  const sign = vi.fn(async () => "0x11" as const),
    payload = { title: "Same draft" };
  await expect(
    signedAction(owner, sign, "create", "stable", 0, payload),
  ).rejects.toThrow("Response lost");
  const result = await signedAction(
    owner,
    sign,
    "create",
    "stable",
    0,
    payload,
  );
  expect(result.id).toBe("stable");
  expect(sign).toHaveBeenCalledTimes(1);
  expect(calls[1]).toEqual(calls[0]);
  expect(storage.size).toBe(0);
});
