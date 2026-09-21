import type { Draft } from "../shared/core";
export type LocalDraft = {
  fields: Omit<Draft, "entries" | "weights">;
  text: string;
  weighted: boolean;
  step: number;
  revision: number;
  giveawayId?: string;
};
const prefix = (owner?: string) =>
  `lottewy:editor:v1:${owner?.toLowerCase() || "guest"}:`;
export const draftKey = (owner?: string, id?: string | null) =>
  prefix(owner) + (id || "new");
export function readDraft(
  owner?: string,
  id?: string | null,
): LocalDraft | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(draftKey(owner, id)) || "null",
    );
    if (
      !value ||
      typeof value.text !== "string" ||
      !value.fields ||
      typeof value.fields.title !== "string" ||
      typeof value.fields.rules !== "string"
    )
      return null;
    return {
      ...value,
      fields: {
        ...value.fields,
        winners:
          typeof value.fields.winners === "number" ? value.fields.winners : NaN,
        reserves:
          typeof value.fields.reserves === "number"
            ? value.fields.reserves
            : NaN,
      },
    };
  } catch {
    return null;
  }
}
export function writeDraft(
  owner: string | undefined,
  id: string | null,
  value: LocalDraft,
) {
  try {
    sessionStorage.setItem(draftKey(owner, id), JSON.stringify(value));
  } catch {
    /* Storage limits never discard the in-memory editor. */
  }
}
export function removeDraft(owner?: string, id?: string | null) {
  try {
    sessionStorage.removeItem(draftKey(owner, id));
  } catch {}
}
export function clearWalletDrafts(owner?: string) {
  if (!owner) return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(prefix(owner))) sessionStorage.removeItem(key);
    }
  } catch {}
}
