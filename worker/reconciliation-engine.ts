import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import {
  assert,
  CHAIN_ID,
  COORDINATOR,
  hash,
  type Giveaway,
} from "../shared/core";
import { consumerAbi, coordinatorAbi } from "../shared/chain";
import { finalizedBlock } from "../shared/finality";
import { trustedClient } from "./reconcile";
import { matchesSubmission } from "./submission";
import type { Env } from "./index";

type Client = Awaited<ReturnType<typeof trustedClient>>;
type Frontier = Awaited<ReturnType<typeof finalizedBlock>>;
type RecordRow = {
  id: string;
  owner: Address;
  revision: number;
  status: string;
  public_json: string;
};
export type AttemptRow = {
  giveaway_id: string;
  attempt_id: string;
  commitment: Hex;
  reserved: number;
  start_block: string;
  state: string;
  sender_nonce: number | null;
  consumer: string | null;
  tx_hash: Hex | null;
  cancel_hash: Hex | null;
  evidence_json: string | null;
  fulfillment_scan_block: string | null;
};
type Log = {
  address: Address;
  transactionHash: Hex;
  blockHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  data: Hex;
  topics: readonly Hex[];
  removed?: boolean;
};
type SyncState = "updated" | "unchanged" | "busy" | "unavailable";
const guard = (env: Env) =>
  env.DB.prepare(
    "INSERT INTO atomic_guard(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
  );
const keyFor = (g: Giveaway) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [
      g.owner as Address,
      hash(g.id),
    ]),
  );
const isMissing = (error: unknown) =>
  error instanceof Error &&
  /TransactionReceiptNotFound|TransactionNotFound/.test(error.name);

async function receiptFor(client: Client, log: Log, frontier: Frontier) {
  assert(
    log.blockNumber <= frontier.number && !log.removed,
    "Event is not finalized",
  );
  const [receipt, block] = await Promise.all([
    client.getTransactionReceipt({ hash: log.transactionHash }),
    client.getBlock({ blockNumber: log.blockNumber }),
  ]);
  assert(
    receipt.status === "success" &&
      receipt.blockNumber === log.blockNumber &&
      receipt.blockHash === log.blockHash &&
      block.hash === log.blockHash,
    "Event receipt mismatch",
  );
  assert(
    receipt.logs.some(
      (r) =>
        r.address.toLowerCase() === log.address.toLowerCase() &&
        r.logIndex === log.logIndex &&
        r.data === log.data &&
        r.topics.join(",") === log.topics.join(","),
    ),
    "Event is absent from its receipt",
  );
  return receipt;
}

/** Release only the exact reservation that produced the authenticated receipt. */
export async function releaseAttempt(
  env: Env,
  row: AttemptRow,
  g: Giveaway,
  token: string,
  candidate: {
    hash: Hex;
    kind: "cancel" | "start";
    blockHash: Hex;
    blockNumber: bigint;
  },
) {
  const restored = { ...g, status: "draft" };
  delete restored.reservation;
  const hashColumn = candidate.kind === "cancel" ? "cancel_hash" : "tx_hash";
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM attempts WHERE giveaway_id=? AND attempt_id=? AND commitment=? AND sender_nonce=? AND ${hashColumn}=? AND EXISTS(SELECT 1 FROM giveaways WHERE id=? AND revision=? AND sync_lease_token=? AND status IN ('submitting','pending'))`,
    ).bind(
      g.id,
      row.attempt_id,
      row.commitment,
      row.sender_nonce,
      candidate.hash,
      g.id,
      g.revision,
      token,
    ),
    guard(env),
    env.DB.prepare(
      "UPDATE giveaways SET status='draft',public_json=? WHERE id=? AND revision=? AND sync_lease_token=? AND status IN ('submitting','pending')",
    ).bind(JSON.stringify(restored), g.id, g.revision, token),
    guard(env),
    env.DB.prepare(
      "INSERT INTO attempt_history(giveaway_id,outcome,snapshot_json,tx_hash,observed) VALUES (?,?,?,?,?)",
    ).bind(
      g.id,
      candidate.kind === "cancel" ? "cancelled" : "reverted",
      JSON.stringify(row),
      candidate.hash,
      Date.now(),
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO chain_events(event_id,giveaway_id,block_hash,block_number,tx_hash,evidence_json,observed) VALUES (?,?,?,?,?,?,?)",
    ).bind(
      `${CHAIN_ID}:${candidate.hash}:release`,
      g.id,
      candidate.blockHash,
      candidate.blockNumber.toString(),
      candidate.hash,
      JSON.stringify({
        kind: candidate.kind === "cancel" ? "cancelled" : "reverted",
        nonce: row.sender_nonce,
        attemptId: row.attempt_id,
      }),
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM atomic_guard"),
  ]);
}

export async function cancellationCandidate(
  client: Client,
  row: AttemptRow,
  g: Giveaway,
  frontier: Frontier,
) {
  if (row.sender_nonce === null) return null;
  // A dropped replacement must not hide a finalized revert of the original start.
  for (const [txHash, kind] of [
    [row.cancel_hash, "cancel"],
    [row.tx_hash, "start"],
  ] as const) {
    if (!txHash) continue;
    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (
        receipt.blockNumber > frontier.number ||
        receipt.status !== (kind === "cancel" ? "success" : "reverted")
      )
        continue;
      const [tx, block] = await Promise.all([
        client.getTransaction({ hash: txHash }),
        client.getBlock({ blockNumber: receipt.blockNumber }),
      ]);
      matchesSubmission(tx, g, row.consumer!, row.sender_nonce, kind);
      assert(
        block.hash === receipt.blockHash,
        "Cancellation receipt is not canonical",
      );
      return {
        hash: txHash,
        kind,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      if (!isMissing(error)) continue;
    }
  }
  return null;
}

async function observe(
  env: Env,
  id: string,
  token: string,
  client: Client,
  frontier: Frontier,
): Promise<SyncState> {
  let record = await env.DB.prepare(
    "SELECT id,owner,revision,status,public_json FROM giveaways WHERE id=? AND sync_lease_token=?",
  )
    .bind(id, token)
    .first<RecordRow>();
  if (!record) return "busy";
  let g = JSON.parse(record.public_json) as Giveaway;
  const address = env.CONSUMER_ADDRESS as Address,
    key = keyFor(g);
  const draw = await client.readContract({
    address,
    abi: consumerAbi,
    functionName: "draws",
    args: [key],
    blockNumber: frontier.number,
  });
  let attempt = await env.DB.prepare(
    "SELECT * FROM attempts WHERE giveaway_id=?",
  )
    .bind(id)
    .first<AttemptRow>();
  if (draw[4] === 0) {
    if (attempt && ["submitting", "pending"].includes(record.status)) {
      const candidate = await cancellationCandidate(
        client,
        { ...attempt, consumer: attempt.consumer || address },
        g,
        frontier,
      );
      if (candidate) {
        await releaseAttempt(env, attempt, g, token, candidate);
        return "updated";
      }
    }
    return "unchanged"; // Missing result, timeout and user rejection never unlock.
  }
  const request = await client.readContract({
    address: COORDINATOR,
    abi: coordinatorAbi,
    functionName: "getRequest",
    args: [draw[2]],
    blockNumber: frontier.number,
  });
  assert(
    draw[0].toLowerCase() === g.owner &&
      request.consumer.toLowerCase() === address.toLowerCase() &&
      request.refundAddress.toLowerCase() === g.owner &&
      request.clientSeed === draw[1] &&
      request.requestBlock <= frontier.number,
    "Chain request bindings mismatch",
  );
  if (record.status === "draft") {
    const versions = await env.DB.prepare(
      "SELECT revision,public_json,private_json FROM revisions WHERE giveaway_id=?",
    )
      .bind(id)
      .all<{ revision: number; public_json: string; private_json: string }>();
    const matched = versions.results.find(
      (v) => (JSON.parse(v.public_json) as Giveaway).commitment === draw[1],
    );
    if (!matched) {
      await env.DB.prepare(
        "UPDATE giveaways SET status='reconciliation' WHERE id=? AND revision=? AND status='draft' AND sync_lease_token=?",
      )
        .bind(id, record.revision, token)
        .run();
      return "updated";
    }
    const attemptId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE giveaways SET revision=?,public_json=?,private_json=?,status='waiting' WHERE id=? AND revision=? AND status='draft' AND sync_lease_token=?",
      ).bind(
        matched.revision,
        matched.public_json,
        matched.private_json,
        id,
        record.revision,
        token,
      ),
      guard(env),
      env.DB.prepare(
        "INSERT INTO attempts(giveaway_id,attempt_id,commitment,reserved,start_block,state,consumer) VALUES (?,?,?,?,?,'waiting',?)",
      ).bind(
        id,
        attemptId,
        draw[1],
        Math.floor(Date.now() / 1000),
        request.requestBlock.toString(),
        address,
      ),
      env.DB.prepare("DELETE FROM atomic_guard"),
    ]);
    g = JSON.parse(matched.public_json) as Giveaway;
    attempt = await env.DB.prepare(
      "SELECT * FROM attempts WHERE giveaway_id=? AND attempt_id=?",
    )
      .bind(id, attemptId)
      .first<AttemptRow>();
  }
  assert(
    attempt &&
      attempt.attempt_id &&
      attempt.commitment === g.commitment &&
      draw[1] === g.commitment,
    "Attempt commitment mismatch",
  );
  // Request state is the authoritative event height, even if it predates UI reservation.
  const events = await client.getContractEvents({
    address,
    abi: consumerAbi,
    eventName: "DrawRequested",
    args: { key },
    fromBlock: request.requestBlock,
    toBlock: request.requestBlock,
  });
  const event = events.find(
    (e) =>
      e.args.owner?.toLowerCase() === g.owner &&
      e.args.giveawayId === hash(g.id) &&
      e.args.commitment === g.commitment &&
      e.args.requestId === draw[2],
  );
  assert(event, "Request event not found");
  await receiptFor(client, event, frontier);
  const anchor = {
    txHash: event.transactionHash,
    blockHash: event.blockHash,
    blockNumber: event.blockNumber.toString(),
    logIndex: event.logIndex,
  };
  if (g.evidence) {
    assert(
      g.evidence.txHash === anchor.txHash &&
        g.evidence.blockHash === anchor.blockHash,
      "Existing request provenance changed",
    );
  }
  const [refundCredit, overpaymentCredit, feePaid, refundBps] =
    await Promise.all([
      client.readContract({
        address: COORDINATOR,
        abi: coordinatorAbi,
        functionName: "refundCredits",
        args: [g.owner as Address],
        blockNumber: frontier.number,
      }),
      client.readContract({
        address,
        abi: consumerAbi,
        functionName: "overpaymentCredits",
        args: [g.owner as Address],
        blockNumber: frontier.number,
      }),
      client.readContract({
        address: COORDINATOR,
        abi: coordinatorAbi,
        functionName: "requestFeePaid",
        args: [draw[2]],
        blockNumber: frontier.number,
      }),
      client.readContract({
        address: COORDINATOR,
        abi: coordinatorAbi,
        functionName: "requestRefundBps",
        args: [draw[2]],
        blockNumber: frontier.number,
      }),
    ]);
  const refundable =
    !request.fulfilled &&
    !request.refunded &&
    request.deadline < frontier.timestamp;
  let status =
    draw[4] === 2
      ? "completed"
      : request.refunded
        ? "expired"
        : request.fulfilled && !request.delivered
          ? "callback"
          : refundable
            ? "refund_due"
            : "waiting";
  g.recovery = {
    requestId: draw[2].toString(),
    consumer: address,
    deadline: request.deadline.toString(),
    callbackFailed: request.fulfilled && !request.delivered,
    refundable,
    refunded: request.refunded,
    refundCredit: refundCredit.toString(),
    overpaymentCredit: overpaymentCredit.toString(),
    feePaid: feePaid.toString(),
    refundBps,
  };
  if (draw[4] === 2) {
    assert(
      request.fulfilled && request.delivered && request.randomness === draw[3],
      "Coordinator result mismatch",
    );
    const from = g.evidence?.fulfillmentBlockNumber
        ? BigInt(g.evidence.fulfillmentBlockNumber)
        : BigInt(attempt.fulfillment_scan_block || request.requestBlock),
      to = g.evidence?.fulfillmentBlockNumber
        ? from
        : from + 1999n < frontier.number
          ? from + 1999n
          : frontier.number;
    assert(from <= frontier.number, "Delivery scan is ahead of finality");
    let logs = await client.getContractEvents({
      address,
      abi: consumerAbi,
      eventName: "DrawFulfilled",
      args: { key, requestId: draw[2] },
      fromBlock: from,
      toBlock: to,
    });
    // A recently retried callback may be far newer than the original proof.
    if (!logs.length && to < frontier.number) {
      const recent = frontier.number > 1999n ? frontier.number - 1999n : 0n;
      logs = await client.getContractEvents({
        address,
        abi: consumerAbi,
        eventName: "DrawFulfilled",
        args: { key, requestId: draw[2] },
        fromBlock:
          recent > request.requestBlock ? recent : request.requestBlock,
        toBlock: frontier.number,
      });
    }
    const fulfillment = logs.find((e) => e.args.word === draw[3]);
    if (!fulfillment) {
      await env.DB.prepare(
        "UPDATE attempts SET fulfillment_scan_block=?,last_error=? WHERE giveaway_id=? AND attempt_id=? AND EXISTS(SELECT 1 FROM giveaways WHERE id=? AND sync_lease_token=?)",
      )
        .bind(
          (to + 1n).toString(),
          "delivery-backfill",
          id,
          attempt.attempt_id,
          id,
          token,
        )
        .run();
      status = "reconciliation";
    } else {
      await receiptFor(client, fulfillment, frontier);
      if (g.evidence?.fulfillmentBlockHash)
        assert(
          g.evidence.fulfillmentBlockHash === fulfillment.blockHash,
          "Existing delivery provenance changed",
        );
      g.evidence = {
        word: draw[3],
        requestId: draw[2].toString(),
        ...anchor,
        consumer: address,
        coordinator: COORDINATOR,
        chainId: CHAIN_ID,
        fulfillmentBlockHash: fulfillment.blockHash,
        fulfillmentBlockNumber: fulfillment.blockNumber.toString(),
        fulfillmentTxHash: fulfillment.transactionHash,
      };
    }
  }
  g.status = status;
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE attempts SET state=?,request_id=?,tx_hash=?,evidence_json=?,last_checked=?,last_error=NULL WHERE giveaway_id=? AND attempt_id=? AND EXISTS(SELECT 1 FROM giveaways WHERE id=? AND sync_lease_token=?)",
    ).bind(
      status,
      draw[2].toString(),
      anchor.txHash,
      JSON.stringify(anchor),
      Date.now(),
      id,
      attempt.attempt_id,
      id,
      token,
    ),
    guard(env),
    env.DB.prepare(
      "UPDATE giveaways SET status=?,public_json=? WHERE id=? AND revision=? AND sync_lease_token=?",
    ).bind(status, JSON.stringify(g), id, g.revision, token),
    guard(env),
    env.DB.prepare(
      "INSERT OR IGNORE INTO chain_events(event_id,giveaway_id,block_hash,block_number,tx_hash,evidence_json,observed) VALUES (?,?,?,?,?,?,?)",
    ).bind(
      `${CHAIN_ID}:${anchor.txHash}:${anchor.logIndex}`,
      id,
      anchor.blockHash,
      anchor.blockNumber,
      anchor.txHash,
      JSON.stringify(anchor),
      Date.now(),
    ),
    env.DB.prepare("DELETE FROM atomic_guard"),
  ]);
  return "updated";
}

async function syncOne(
  env: Env,
  id: string,
  getSnapshot: () => Promise<{ client: Client; frontier: Frontier }>,
): Promise<SyncState> {
  const token = crypto.randomUUID(),
    started = Date.now();
  const lease = await env.DB.prepare(
    "UPDATE giveaways SET sync_lease_token=?,sync_lease_until=? WHERE id=? AND sync_lease_until<=? AND chain_checked_at<=?",
  )
    .bind(token, started + 20000, id, started, started - 2000)
    .run();
  if (lease.meta.changes !== 1) return "busy";
  try {
    const { client, frontier } = await getSnapshot();
    return await observe(env, id, token, client, frontier);
  } catch (error) {
    const category =
      error instanceof Error && error.name === "Error"
        ? "binding-check"
        : "rpc-unavailable";
    await env.DB.prepare(
      "UPDATE attempts SET last_error=? WHERE giveaway_id=? AND EXISTS(SELECT 1 FROM giveaways WHERE id=? AND sync_lease_token=?)",
    )
      .bind(category, id, id, token)
      .run();
    return "unavailable";
  } finally {
    // All paths advance their scheduling position, including no-draw and RPC errors.
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE attempts SET last_checked=? WHERE giveaway_id=? AND EXISTS(SELECT 1 FROM giveaways WHERE id=? AND sync_lease_token=?)",
      ).bind(Date.now(), id, id, token),
      env.DB.prepare(
        "UPDATE giveaways SET chain_checked_at=?,sync_lease_until=0,sync_lease_token=NULL WHERE id=? AND sync_lease_token=?",
      ).bind(Date.now(), id, token),
    ]);
  }
}

export async function reconciliationQueue(env: Env) {
  const [active, drafts, terminal] = await Promise.all([
    env.DB.prepare(
      "SELECT id FROM giveaways WHERE status NOT IN ('draft','completed','expired') ORDER BY chain_checked_at,id LIMIT 20",
    ).all<{ id: string }>(),
    env.DB.prepare(
      "SELECT id FROM giveaways WHERE status='draft' ORDER BY chain_checked_at,id LIMIT 5",
    ).all<{ id: string }>(),
    env.DB.prepare(
      "SELECT id FROM giveaways WHERE status IN ('completed','expired') AND chain_checked_at<? ORDER BY chain_checked_at,id LIMIT 2",
    )
      .bind(Date.now() - 60000)
      .all<{ id: string }>(),
  ]);
  return [...active.results, ...drafts.results, ...terminal.results].map(
    (r) => r.id,
  );
}

/** Test seam takes an already authenticated client; public routes use reconcile(). */
export async function reconcileWithClient(
  env: Env,
  client: Client,
  frontier: Frontier,
  id: string,
) {
  return syncOne(env, id, async () => ({ client, frontier }));
}
export async function reconcile(
  env: Env,
  options: { giveawayId?: string } = {},
): Promise<SyncState> {
  if (!env.CONSUMER_ADDRESS || !env.CONSUMER_CODE_HASH) return "unavailable";
  const ids = options.giveawayId
    ? [options.giveawayId]
    : await reconciliationQueue(env);
  let snapshot: Promise<{ client: Client; frontier: Frontier }> | undefined;
  const getSnapshot = () =>
    (snapshot ??= (async () => {
      const client = await trustedClient(env);
      return { client, frontier: await finalizedBlock(client) };
    })());
  if (options.giveawayId) return syncOne(env, options.giveawayId, getSnapshot);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        await syncOne(env, id, getSnapshot);
      }
    }),
  );
  return "updated";
}
