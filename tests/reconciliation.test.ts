import { describe, it, expect, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { database } from "./d1";
import { hash, type Giveaway } from "../shared/core";
import { consumerAbi } from "../shared/chain";
import {
  releaseAttempt,
  cancellationCandidate,
  reconciliationQueue,
  reconcileWithClient,
  type AttemptRow,
} from "../worker/reconciliation-engine";
const owner = "0x0000000000000000000000000000000000000001",
  consumer = "0x0000000000000000000000000000000000000002";
const frontier = { number: 100n, hash: hash("block"), timestamp: 1000n };
function setup(id = "one", status = "pending") {
  const db = database(),
    env = { DB: db, CONSUMER_ADDRESS: consumer } as any;
  db.sqlite
    .prepare("INSERT INTO users(address,created) VALUES (?,0)")
    .run(owner);
  const g = {
    id,
    slug: id,
    owner,
    revision: 1,
    status,
    commitment: hash(id),
  } as Giveaway;
  db.sqlite
    .prepare(
      "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created,sync_lease_token) VALUES (?,?,?,1,?,?,?,0,?)",
    )
    .run(id, id, owner, status, JSON.stringify(g), "{}", "lease");
  const row = {
    giveaway_id: id,
    attempt_id: "A",
    commitment: g.commitment,
    reserved: 0,
    start_block: "90",
    state: status,
    sender_nonce: 7,
    consumer,
    tx_hash: hash("start"),
    cancel_hash: hash("cancel"),
    evidence_json: null,
    fulfillment_scan_block: null,
  } satisfies AttemptRow;
  db.sqlite
    .prepare(
      "INSERT INTO attempts(giveaway_id,attempt_id,commitment,reserved,start_block,state,sender_nonce,consumer,tx_hash,cancel_hash) VALUES (?,?,?,0,?,?,?,?,?,?)",
    )
    .run(
      id,
      "A",
      g.commitment,
      "90",
      status,
      7,
      consumer,
      row.tx_hash,
      row.cancel_hash,
    );
  return { db, env, g, row };
}
describe("reconciliation concurrency and fairness", () => {
  it("stale cancellation A cannot delete replacement reservation B at the same revision", async () => {
    const { db, env, g, row } = setup();
    db.sqlite
      .prepare("UPDATE attempts SET attempt_id='B',sender_nonce=8")
      .run();
    await expect(
      releaseAttempt(env, row, g, "lease", {
        hash: row.cancel_hash!,
        kind: "cancel",
        blockHash: frontier.hash,
        blockNumber: 100n,
      }),
    ).rejects.toThrow();
    expect(
      db.sqlite.prepare("SELECT attempt_id FROM attempts").get(),
    ).toMatchObject({ attempt_id: "B" });
    expect(
      db.sqlite.prepare("SELECT status FROM giveaways").get(),
    ).toMatchObject({ status: "pending" });
    expect(
      db.sqlite.prepare("SELECT count(*) n FROM attempt_history").get(),
    ).toMatchObject({ n: 0 });
  });
  it("releases and archives only the current exact reservation", async () => {
    const { db, env, g, row } = setup();
    await releaseAttempt(env, row, g, "lease", {
      hash: row.cancel_hash!,
      kind: "cancel",
      blockHash: frontier.hash,
      blockNumber: 100n,
    });
    expect(
      db.sqlite.prepare("SELECT count(*) n FROM attempts").get(),
    ).toMatchObject({ n: 0 });
    expect(
      db.sqlite.prepare("SELECT status FROM giveaways").get(),
    ).toMatchObject({ status: "draft" });
    expect(
      db.sqlite.prepare("SELECT outcome FROM attempt_history").get(),
    ).toMatchObject({ outcome: "cancelled" });
  });
  it("a missing replacement does not hide the finalized original revert", async () => {
    const { g, row } = setup();
    const client = {
      getTransactionReceipt: async ({ hash: h }: any) => {
        if (h === row.cancel_hash) {
          const e = new Error();
          e.name = "TransactionReceiptNotFoundError";
          throw e;
        }
        return {
          status: "reverted",
          blockNumber: 100n,
          blockHash: frontier.hash,
        };
      },
      getBlock: async () => frontier,
      getTransaction: async () => ({
        from: owner,
        to: consumer,
        nonce: 7,
        value: 1n,
        input: encodeFunctionData({
          abi: consumerAbi,
          functionName: "start",
          args: [hash(g.id), g.commitment],
        }),
      }),
    } as any;
    expect(await cancellationCandidate(client, row, g, frontier)).toMatchObject(
      { kind: "start", hash: row.tx_hash },
    );
    expect(
      await cancellationCandidate(client, row, g, { ...frontier, number: 99n }),
    ).toBeNull();
  });
  it("advances empty draws and RPC failures so old rows cannot starve later records", async () => {
    const { db, env } = setup("g00", "draft");
    for (let i = 1; i < 56; i++) {
      const id = `g${String(i).padStart(2, "0")}`;
      db.sqlite
        .prepare(
          "INSERT INTO giveaways(id,slug,owner,revision,status,public_json,private_json,created) VALUES (?,?,?,1,?,?,?,0)",
        )
        .run(
          id,
          id,
          owner,
          "draft",
          JSON.stringify({ id, owner, revision: 1, commitment: hash(id) }),
          "{}",
        );
    }
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++)
      for (const id of await reconciliationQueue(env)) {
        seen.add(id);
        await reconcileWithClient(
          env,
          {
            readContract: async () => {
              if (id === "g01") throw new Error("offline");
              return [owner, hash(id), 0n, hash("zero"), 0];
            },
          } as any,
          frontier,
          id,
        );
      }
    expect(seen.size).toBe(56);
    expect(
      db.sqlite
        .prepare("SELECT chain_checked_at FROM giveaways WHERE id='g01'")
        .get()!.chain_checked_at,
    ).toBeGreaterThan(0);
  });
  it("coalesces overlapping checks under one per-record lease", async () => {
    const { env } = setup();
    let resolve!: () => void;
    const waiting = new Promise<void>((r) => (resolve = r));
    const readContract = vi.fn(async () => {
      await waiting;
      return [owner, hash("one"), 0n, hash("zero"), 0];
    });
    const client = {
      readContract,
      getTransactionReceipt: async () => {
        throw new Error("missing");
      },
    } as any;
    const first = reconcileWithClient(env, client, frontier, "one");
    await new Promise((r) => setTimeout(r, 0));
    expect(await reconcileWithClient(env, client, frontier, "one")).toBe(
      "busy",
    );
    resolve();
    await first;
    expect(readContract).toHaveBeenCalledTimes(1);
  });
  it("finds a request before reservation and publishes delivery at finalized height without a 12-block delay", async () => {
    const { db, env, g } = setup();
    const requestLog = {
      address: consumer,
      transactionHash: hash("request"),
      blockHash: hash("request-block"),
      blockNumber: 80n,
      logIndex: 0,
      data: "0x",
      topics: [],
      args: {
        owner,
        giveawayId: hash(g.id),
        commitment: g.commitment,
        requestId: 5n,
      },
    };
    const delivery = {
      ...requestLog,
      transactionHash: hash("delivery"),
      blockHash: frontier.hash,
      blockNumber: 100n,
      args: { word: hash("word") },
    };
    const getContractEvents = vi.fn(async ({ eventName }: any) =>
      eventName === "DrawRequested" ? [requestLog] : [delivery],
    );
    const client = {
      getContractEvents,
      readContract: async ({ functionName }: any) =>
        functionName === "draws"
          ? [owner, g.commitment, 5n, hash("word"), 2]
          : functionName === "getRequest"
            ? {
                consumer,
                refundAddress: owner,
                clientSeed: g.commitment,
                requestBlock: 80n,
                deadline: 2000n,
                fulfilled: true,
                delivered: true,
                randomness: hash("word"),
              }
            : functionName === "requestRefundBps"
              ? 10000
              : 0n,
      getTransactionReceipt: async ({ hash: h }: any) => {
        const log = h === requestLog.transactionHash ? requestLog : delivery;
        return {
          status: "success",
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          logs: [log],
        };
      },
      getBlock: async ({ blockNumber }: any) => ({
        hash: blockNumber === 80n ? requestLog.blockHash : frontier.hash,
      }),
    } as any;
    expect(await reconcileWithClient(env, client, frontier, g.id)).toBe(
      "updated",
    );
    expect(getContractEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "DrawRequested",
        fromBlock: 80n,
        toBlock: 80n,
      }),
    );
    const stored = db.sqlite
      .prepare("SELECT status,public_json FROM giveaways")
      .get()!;
    expect(stored.status).toBe("completed");
    expect(
      JSON.parse(stored.public_json as string).evidence.fulfillmentTxHash,
    ).toBe(delivery.transactionHash);
  });
});
