import { useState } from "react";
import {
  formatEther,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
} from "viem";
import { Dialog } from "./components/primitives";
import { api } from "./api";
import { CHAIN_ID, hash, type Giveaway } from "../shared/core";
import { consumerAbi } from "../shared/chain";
export default function SubmissionRecovery({
  g,
  client,
  send,
  busy,
  run,
  notify,
}: {
  g: Giveaway;
  client: any;
  send: any;
  busy: boolean;
  run: (f: () => Promise<void>) => void;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [price, setPrice] = useState<bigint | null>(null);
  if (!g.reservation || g.reservation.nonce === null) return null;
  const prepare = () =>
    run(async () => {
      setOpen(true);
      setPrice((await client.getGasPrice()) * 2n);
    });
  const cancel = () =>
    run(async () => {
      const key = keccak256(
        encodeAbiParameters(parseAbiParameters("address,bytes32"), [
          g.owner as Address,
          hash(g.id),
        ]),
      );
      const draw = await client.readContract({
        address: g.reservation!.consumer,
        abi: consumerAbi,
        functionName: "draws",
        args: [key],
      });
      if (draw[4] !== 0)
        throw new Error(
          "The randomness request was already accepted. It cannot be cancelled.",
        );
      const code = await client.getCode({ address: g.owner });
      if (code && code !== "0x")
        throw new Error(
          "This wallet needs its own transaction cancellation flow. The list stays locked.",
        );
      const txHash = await send({
        chainId: CHAIN_ID,
        to: g.owner,
        value: 0n,
        data: "0x",
        nonce: g.reservation!.nonce,
        gas: 21000n,
        gasPrice: price,
      });
      await api("/submission-hint", { id: g.id, txHash, kind: "cancel" });
      setOpen(false);
      notify(
        "Cancellation submitted. Editing returns only after its receipt is confirmed and no draw exists.",
      );
    });
  return (
    <>
      <button className="text-button" onClick={prepare} disabled={busy}>
        Recover a rejected or pending submission
      </button>
      <Dialog
        open={open}
        close={() => !busy && setOpen(false)}
        title="Cancel this pending submission?"
      >
        <p>
          This sends a zero-value transaction to your own wallet. It uses
          network gas to prevent the earlier draw transaction from being
          accepted later.
        </p>
        <p>
          Your list remains locked until cancellation is confirmed. A randomness
          request that has already been accepted cannot be cancelled or
          rerolled.
        </p>
        <div className="cost-lines">
          <div>
            <span>Estimated cancellation gas</span>
            <strong>
              {price ? `${formatEther(price * 21000n)} USDC` : "Calculating…"}
            </strong>
          </div>
          <div>
            <span>Lottewy fee</span>
            <strong>0</strong>
          </div>
        </div>
        <button
          className="button primary full"
          disabled={busy || !price}
          onClick={cancel}
        >
          Cancel submission in wallet
        </button>
      </Dialog>
    </>
  );
}
