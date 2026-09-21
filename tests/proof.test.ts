import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEventLogs,
} from "viem";
import { consumerAbi } from "../shared/chain";
import { COORDINATOR, hash, type Giveaway } from "../shared/core";
import deployment from "../docs/arc-testnet.json";
import consumerDeployment from "../docs/lottewy-testnet.json";
import fixture from "../docs/testnet-public-manifest.json";

const mocks = vi.hoisted(() => ({ rpc: {} as any, verify: vi.fn() }));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  const d = await import("../docs/arc-testnet.json");
  const c = await import("../docs/lottewy-testnet.json");
  return {
    ...actual,
    createPublicClient: () => mocks.rpc,
    keccak256: (value: any) => {
      if (value === "0x01") return c.default.codeHash;
      if (value === "0x02") return d.default.coordinatorImplementationCodeHash;
      if (value === "0x03") return d.default.epochImplementationCodeHash;
      if (value === "0x04") return c.default.implementationCodeHash;
      return actual.keccak256(value);
    },
  };
});
// These tests isolate RPC provenance checks; VRF mathematics remains the SDK's job.
vi.mock("@d20dao/vrf-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@d20dao/vrf-sdk")>()),
  decodeEvidencePacket: () => ({ proof: {} }),
  deriveRequestSeed: () => 1n,
  hashProof: () => `0x${"aa".repeat(32)}`,
  verifyVRFProof: mocks.verify,
}));
import { verifyD20 } from "../shared/proof";

const evidenceAbi = parseAbi([
  "event FulfillmentEvidence(uint256 indexed requestId, bytes32 indexed transcriptHash, bytes packet)",
]);
const hex = (byte: string) => `0x${byte.repeat(32)}` as const;
const requestTx = hex("11"),
  acceptanceTx = hex("22"),
  unrelatedTx = hex("33");
const requestHash = hex("44"),
  acceptanceHash = hex("55"),
  otherHash = hex("66");
const consumer = consumerDeployment.address as `0x${string}`;
let g: Giveaway,
  request: any,
  receipts: Map<string, any>,
  blocks: Map<bigint, any>;
let key: `0x${string}`, finalizedHeight: bigint;

function receipt(tx: string, block: bigint, blockHash: string, logs: any[]) {
  return {
    transactionHash: tx,
    blockNumber: block,
    blockHash,
    status: "success",
    logs: logs.map((log, logIndex) => ({
      ...log,
      transactionHash: tx,
      blockNumber: block,
      blockHash,
      logIndex,
      transactionIndex: 0,
      removed: false,
    })),
  };
}
function requestedLog(overrides: Record<string, any> = {}) {
  const args = {
    key,
    owner: g.owner,
    giveawayId: hash(g.id),
    commitment: g.commitment,
    requestId: BigInt(g.evidence!.requestId),
    ...overrides,
  };
  return {
    address: consumer,
    topics: encodeEventTopics({
      abi: consumerAbi,
      eventName: "DrawRequested",
      args: args as any,
    }),
    data: encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [
      args.commitment,
      args.requestId,
    ]),
  };
}
function deliveredLog(overrides: Record<string, any> = {}) {
  const args = {
    key,
    requestId: BigInt(g.evidence!.requestId),
    word: g.evidence!.word,
    ...overrides,
  };
  return {
    address: consumer,
    topics: encodeEventTopics({
      abi: consumerAbi,
      eventName: "DrawFulfilled",
      args,
    }),
    data: encodeAbiParameters(parseAbiParameters("bytes32"), [args.word]),
  };
}

beforeEach(() => {
  g = structuredClone(fixture) as Giveaway;
  Object.assign(g.evidence!, {
    consumer,
    txHash: requestTx,
    blockHash: requestHash,
    blockNumber: "100",
    fulfillmentTxHash: acceptanceTx,
    fulfillmentBlockHash: acceptanceHash,
    fulfillmentBlockNumber: "105",
  });
  key = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [
      g.owner as any,
      hash(g.id),
    ]),
  );
  request = {
    consumer,
    refundAddress: g.owner,
    clientSeed: g.commitment,
    fulfilled: true,
    delivered: true,
    randomness: g.evidence!.word,
    requestBlock: 100n,
    targetBlock: 101n,
    blockHash: hex("77"),
    deadline: 1000n,
    transcriptHash: hex("bb"),
    proofHash: hex("aa"),
    epochId: 1n,
    epochHash: hex("cc"),
  };
  const proofLog = {
    address: COORDINATOR,
    topics: encodeEventTopics({
      abi: evidenceAbi,
      eventName: "FulfillmentEvidence",
      args: {
        requestId: BigInt(g.evidence!.requestId),
        transcriptHash: request.transcriptHash,
      },
    }),
    data: encodeAbiParameters(parseAbiParameters("bytes"), ["0x1234"]),
  };
  receipts = new Map([
    [requestTx, receipt(requestTx, 100n, requestHash, [requestedLog()])],
    [
      acceptanceTx,
      receipt(acceptanceTx, 105n, acceptanceHash, [proofLog, deliveredLog()]),
    ],
    [unrelatedTx, receipt(unrelatedTx, 99n, otherHash, [])],
  ]);
  blocks = new Map([
    [99n, { hash: otherHash, timestamp: 990n }],
    [100n, { hash: requestHash, timestamp: 991n }],
    [101n, { hash: request.blockHash, timestamp: 992n }],
    [105n, { hash: acceptanceHash, timestamp: 995n }],
  ]);
  finalizedHeight = 105n;
  mocks.verify
    .mockReset()
    .mockReturnValue({ valid: true, randomness: g.evidence!.word });
  mocks.rpc = {
    getChainId: async () => 5042002,
    getBlockNumber: vi.fn(() => {
      throw new Error("Latest is not a finality source");
    }),
    getCode: async ({ address }: any) =>
      address === consumer
        ? "0x01"
        : address === deployment.coordinatorImplementation
          ? "0x02"
          : address === consumerDeployment.implementationAddress ? '0x04' : "0x03",
    getStorageAt: async ({ address }: any) =>
      `0x${"0".repeat(24)}${(address === consumer ? consumerDeployment.implementationAddress : address === deployment.coordinator ? deployment.coordinatorImplementation : deployment.epochImplementation).slice(2)}`,
    readContract: async ({ functionName }: any) =>
      functionName === "coordinator"
        ? COORDINATOR
        : functionName === "getRequest"
          ? request
          : [
              g.owner,
              g.commitment,
              BigInt(g.evidence!.requestId),
              g.evidence!.word,
              2,
            ],
    getTransactionReceipt: async ({ hash }: any) => {
      const found = receipts.get(hash);
      if (!found) throw new Error("Unknown receipt");
      return found;
    },
    getBlock: vi.fn(async ({ blockNumber, blockTag }: any) => {
      if (blockTag === "finalized")
        return {
          number: finalizedHeight,
          hash: blocks.get(finalizedHeight)?.hash || hex("dd"),
          timestamp: blocks.get(finalizedHeight)?.timestamp || 1000n,
        };
      return blocks.get(blockNumber);
    }),
    getContractEvents: async ({ eventName }: any) =>
      parseEventLogs({
        abi: eventName === "FulfillmentEvidence" ? evidenceAbi : consumerAbi,
        eventName,
        logs: receipts.get(acceptanceTx).logs,
        strict: true,
      } as any),
  };
});

describe("independent proof transaction provenance", () => {
  it("accepts matching receipts at the finalized frontier without extra confirmation blocks", async () => {
    await expect(verifyD20(g)).resolves.toMatchObject({ valid: true });
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.rpc.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(mocks.rpc.getBlockNumber).not.toHaveBeenCalled();
  });
  it("rejects an unrelated successful transaction and its genuine block hash", async () => {
    Object.assign(g.evidence!, {
      txHash: unrelatedTx,
      blockHash: otherHash,
      blockNumber: "99",
    });
    await expect(verifyD20(g)).rejects.toThrow("Receipt or consumer mismatch");
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects an unrelated successful transaction even in the request block", async () => {
    receipts.set(unrelatedTx, receipt(unrelatedTx, 100n, requestHash, []));
    g.evidence!.txHash = unrelatedTx;
    await expect(verifyD20(g)).rejects.toThrow("matching draw");
  });
  it.each(["key", "owner", "giveawayId", "commitment", "requestId"])(
    "rejects a mismatched request %s",
    async (field) => {
      const value =
        field === "owner" ? consumer : field === "requestId" ? 999n : hex("ee");
      receipts.set(
        requestTx,
        receipt(requestTx, 100n, requestHash, [
          requestedLog({ [field]: value }),
        ]),
      );
      await expect(verifyD20(g)).rejects.toThrow("matching draw");
    },
  );
  it("rejects an event with identical arguments emitted by another contract", async () => {
    receipts.get(requestTx).logs[0].address = COORDINATOR;
    await expect(verifyD20(g)).rejects.toThrow("matching draw");
  });
  it.each(["blockHash", "blockNumber", "transactionHash", "removed"])(
    "rejects inconsistent request log %s",
    async (field) => {
      receipts.get(requestTx).logs[0][field] =
        field === "blockNumber" ? 99n : field === "removed" ? true : hex("ee");
      await expect(verifyD20(g)).rejects.toThrow("matching draw");
    },
  );
  it("rejects a request block replaced by a reorg", async () => {
    blocks.get(100n).hash = otherHash;
    await expect(verifyD20(g)).rejects.toThrow("Request block");
  });
  it("rejects a request above the finalized frontier", async () => {
    finalizedHeight = 99n;
    await expect(verifyD20(g)).rejects.toThrow("Request block");
  });
  it("rejects proof acceptance above the finalized frontier", async () => {
    finalizedHeight = 104n;
    await expect(verifyD20(g)).rejects.toThrow("Block or finality");
  });
  it("fails closed when the finalized tag is unavailable", async () => {
    mocks.rpc.getBlock.mockRejectedValue(
      new Error("Finalized tag unsupported"),
    );
    await expect(verifyD20(g)).rejects.toThrow("Finalized tag unsupported");
    expect(mocks.rpc.getBlockNumber).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { number: null, hash: acceptanceHash, timestamp: 995n },
    { number: 105n, hash: null, timestamp: 995n },
    { number: 105n, hash: "0x1234", timestamp: 995n },
  ])("rejects an invalid finalized snapshot: %s", async (snapshot) => {
    mocks.rpc.getBlock.mockResolvedValue(snapshot);
    await expect(verifyD20(g)).rejects.toThrow(
      "Finalized block is unavailable",
    );
    expect(mocks.rpc.getBlockNumber).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("rejects a forged proof log absent from the acceptance receipt", async () => {
    const logs = await mocks.rpc.getContractEvents({
      eventName: "FulfillmentEvidence",
    });
    mocks.rpc.getContractEvents = async () => logs;
    receipts.get(acceptanceTx).logs.shift();
    await expect(verifyD20(g)).rejects.toThrow("not included");
  });
  it.each([
    "fulfillmentTxHash",
    "fulfillmentBlockHash",
    "fulfillmentBlockNumber",
  ])("rejects tampered %s", async (field) => {
    (g.evidence as any)[field] =
      field === "fulfillmentTxHash"
        ? unrelatedTx
        : field === "fulfillmentBlockNumber"
          ? "104"
          : otherHash;
    await expect(verifyD20(g)).rejects.toThrow("Fulfillment receipt");
  });
  it.each(["key", "requestId", "word"])(
    "rejects mismatched delivery %s",
    async (field) => {
      const accepted = receipts.get(acceptanceTx);
      const bad = receipt(acceptanceTx, 105n, acceptanceHash, [
        deliveredLog({ [field]: field === "requestId" ? 999n : otherHash }),
      ]);
      accepted.logs[1] = { ...bad.logs[0], logIndex: 1 };
      await expect(verifyD20(g)).rejects.toThrow(
        "Fulfillment receipt does not contain",
      );
    },
  );
  it("accepts a later finalized callback retry with its own authentic receipt", async () => {
    const retryTx = hex("88"),
      retryHash = hex("99");
    receipts.get(acceptanceTx).logs.pop();
    receipts.set(retryTx, receipt(retryTx, 108n, retryHash, [deliveredLog()]));
    blocks.set(108n, { hash: retryHash, timestamp: 1002n });
    Object.assign(g.evidence!, {
      fulfillmentTxHash: retryTx,
      fulfillmentBlockHash: retryHash,
      fulfillmentBlockNumber: "108",
    });
    finalizedHeight = 108n;
    await expect(verifyD20(g)).resolves.toMatchObject({ valid: true });
    finalizedHeight = 107n;
    await expect(verifyD20(g)).rejects.toThrow(
      "Fulfillment receipt or finality",
    );
  });
  it("supports legacy evidence without explicit delivery fields", async () => {
    delete g.evidence!.fulfillmentTxHash;
    delete g.evidence!.fulfillmentBlockHash;
    delete g.evidence!.fulfillmentBlockNumber;
    await expect(verifyD20(g)).resolves.toMatchObject({ valid: true });
  });
});
