import { actionData, hash, type Action } from "../shared/core";
type Envelope = { action: Action; signature: `0x${string}` };
const pending = new Map<string, Envelope>();
const pendingKey = (address: string, id: string, type: string) =>
  `lottewy:editor:v1:${address.toLowerCase()}:signed:${id}:${type}`;
function saveEnvelope(key: string, value: Envelope) {
  pending.set(key, value);
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function removeEnvelope(key: string) {
  pending.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
export function clearPendingActions(address?: string) {
  if (!address) return;
  const prefix = `lottewy:editor:v1:${address.toLowerCase()}:signed:`;
  for (const key of pending.keys())
    if (key.startsWith(prefix)) removeEnvelope(key);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {}
}
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
  const key = pendingKey(address, giveawayId, actionType),
    payloadHash = hash(payload);
  let cached = pending.get(key);
  if (!cached)
    try {
      cached = JSON.parse(sessionStorage.getItem(key) || "null") || undefined;
    } catch {}
  if (
    cached?.action?.payloadHash === payloadHash &&
    cached.action.expectedRevision === revision &&
    cached.action.signer.toLowerCase() === address.toLowerCase()
  ) {
    progress?.("Retrying the signed request…");
    try {
      const result = await api("/actions", {
        ...cached,
        payload,
        turnstileToken: checks?.turnstileToken,
      });
      removeEnvelope(key);
      return result;
    } catch (error) {
      if ((error as Error).message !== "Action has expired") throw error;
      removeEnvelope(key);
    }
  } else removeEnvelope(key);
  progress?.("Checking wallet eligibility…");
  const challenge = await api("/actions/challenge", { actionType });
  const action: Action = {
    signer: address,
    actionId: crypto.randomUUID(),
    actionType,
    giveawayId,
    payloadHash,
    expectedRevision: revision,
    ...challenge,
  };
  progress?.("Waiting for your wallet signature…");
  const signature = await sign(actionData(action));
  saveEnvelope(key, { action, signature });
  progress?.("Reviewing content and saving…");
  const result = await api("/actions", {
    action,
    payload,
    signature,
    turnstileToken: checks?.turnstileToken,
  });
  removeEnvelope(key);
  return result;
}
