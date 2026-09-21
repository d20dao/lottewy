import { decodeFunctionData, type Address, type Hex } from "viem";
import { assert, hash, type Giveaway } from "../shared/core";
import { consumerAbi } from "../shared/chain";
import { trustedClient, retryRead } from "./reconcile";
import type { Env } from "./index";
export type SubmissionTx = {
  from: Address;
  to: Address | null;
  nonce: number;
  value: bigint;
  input: Hex;
};
export function matchesSubmission(
  tx: SubmissionTx,
  g: Giveaway,
  consumer: string,
  nonce: number | null,
  kind: "start" | "cancel",
) {
  assert(tx.from.toLowerCase() === g.owner, "Transaction signer mismatch");
  if (nonce !== null) assert(tx.nonce === nonce, "Transaction nonce mismatch");
  if (kind === "cancel") {
    assert(
      nonce !== null &&
        tx.to?.toLowerCase() === g.owner &&
        tx.value === 0n &&
        tx.input === "0x",
      "Cancellation must consume the reserved nonce with a zero-value self transaction",
    );
    return;
  }
  assert(
    tx.to?.toLowerCase() === consumer.toLowerCase(),
    "Transaction consumer mismatch",
  );
  const call = decodeFunctionData({ abi: consumerAbi, data: tx.input });
  assert(
    call.functionName === "start" &&
      call.args[0] === hash(g.id) &&
      call.args[1] === g.commitment,
    "Transaction inputs do not match this giveaway",
  );
}
export async function reserveTransaction(env: Env, owner: Address) {
  const rpc = await trustedClient(env),
    code = await rpc.getCode({ address: owner });
  return {
    consumer: env.CONSUMER_ADDRESS,
    nonce:
      !code || code === "0x"
        ? await rpc.getTransactionCount({ address: owner, blockTag: "pending" })
        : null,
  };
}
export async function recordSubmission(
  env: Env,
  owner: Address,
  id: string,
  txHash: Hex,
  kind: "start" | "cancel",
) {
  assert(
    /^0x[\da-fA-F]{64}$/.test(txHash) && ["start", "cancel"].includes(kind),
    "Invalid transaction reference",
  );
  const row = await env.DB.prepare(
    "SELECT a.*,g.public_json,g.owner,g.status AS giveaway_status FROM attempts a JOIN giveaways g ON g.id=a.giveaway_id WHERE a.giveaway_id=?",
  )
    .bind(id)
    .first<{
      sender_nonce: number | null;
      consumer: string;
      public_json: string;
      owner: string;
      tx_hash: string | null;
      cancel_hash: string | null;
      giveaway_status: string;
      attempt_id: string;
    }>();
  assert(
    row &&
      row.owner === owner &&
      ["submitting", "pending"].includes(row.giveaway_status),
    "Submission is not pending for this wallet",
  );
  const rpc = await trustedClient(env),
    tx = await retryRead(() => rpc.getTransaction({ hash: txHash })),
    g = JSON.parse(row.public_json) as Giveaway;
  matchesSubmission(
    tx,
    g,
    row.consumer || env.CONSUMER_ADDRESS,
    row.sender_nonce,
    kind,
  );
  // This is a hint authenticated by the wallet-signed chain transaction, not a
  // new user mutation. Receipt/finality reconciliation makes the state decision.
  if (kind === "start")
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE attempts SET tx_hash=?,state='pending' WHERE giveaway_id=? AND attempt_id=? AND state IN ('submitting','pending')",
      ).bind(txHash, id, row.attempt_id),
      env.DB.prepare(
        "INSERT INTO atomic_guard(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
      ),
      env.DB.prepare(
        "UPDATE giveaways SET status='pending' WHERE id=? AND status='submitting' AND EXISTS(SELECT 1 FROM attempts WHERE giveaway_id=? AND attempt_id=?)",
      ).bind(id, id, row.attempt_id),
      env.DB.prepare("DELETE FROM atomic_guard"),
    ]);
  else {
    const changed = await env.DB.prepare(
      "UPDATE attempts SET cancel_hash=? WHERE giveaway_id=? AND attempt_id=? AND state IN ('submitting','pending')",
    )
      .bind(txHash, id, row.attempt_id)
      .run();
    assert(
      changed.meta.changes === 1,
      "The reservation changed. Check its current status.",
    );
  }
  return { ok: true };
}
