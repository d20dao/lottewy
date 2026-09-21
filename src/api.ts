import { actionData, hash, type Action } from "../shared/core";
export async function api<T = any>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  const body = (await res.json()) as any;
  if (!res.ok)
    throw Object.assign(
      new Error(body.error || "The request could not be completed"),
      { code: body.code },
    );
  return body;
}
export async function signedAction(
  address: `0x${string}`,
  sign: (data: any) => Promise<`0x${string}`>,
  actionType: string,
  giveawayId: string,
  revision: number,
  payload: unknown,
  progress?: (message: string) => void,
  checks?: { turnstileToken?: string },
) {
  progress?.("Checking wallet eligibility…");
  const challenge = await api("/actions/challenge", { actionType });
  const action: Action = {
    signer: address,
    actionId: crypto.randomUUID(),
    actionType,
    giveawayId,
    payloadHash: hash(payload),
    expectedRevision: revision,
    ...challenge,
  };
  progress?.("Waiting for your wallet signature…");
  const signature = await sign(actionData(action));
  progress?.("Reviewing content and saving…");
  return api("/actions", {
    action,
    payload,
    signature,
    turnstileToken: checks?.turnstileToken,
  });
}
