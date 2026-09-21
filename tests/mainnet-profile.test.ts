import { it, expect, vi } from "vitest";
it("selects mainnet addresses and rejects testnet evidence before any RPC call", async () => {
  vi.stubGlobal("__LOTTEWY_MAINNET__", true);
  vi.resetModules();
  try {
    const { CHAIN_ID, COORDINATOR } = await import("../shared/core"),
      { arc } = await import("../shared/chain"),
      { consumerDeployment } = await import("../shared/network"),
      { verifyD20 } = await import("../shared/proof");
    expect(CHAIN_ID).toBe(5042);
    expect(arc.testnet).toBe(false);
    expect(COORDINATOR.toLowerCase()).toBe(
      "0xd20da057469c45928912d983f45790c41e290571",
    );
    expect(consumerDeployment.address).toBe(
      "0x70824f30bd7a3d3994a5579ad5752d9f0f4a557e",
    );
    await expect(
      verifyD20({
        evidence: { chainId: 5042002, coordinator: COORDINATOR },
      } as any),
    ).rejects.toThrow("Evidence network");
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
