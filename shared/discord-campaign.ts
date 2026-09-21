import {
  assert,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  RULES_MAX_LENGTH,
} from "./core";
export type DiscordCampaignInput = {
  title: string;
  description: string;
  rules: string;
  winners: number;
  reserves: number;
  listed: boolean;
  linkId: string;
  endsAt: number;
};
export function normalizeDiscordCampaign(
  input: DiscordCampaignInput,
): DiscordCampaignInput {
  const text = (value: unknown, min: number, max: number, name: string) => {
    assert(typeof value === "string", `${name} is required`);
    const result = value.normalize("NFC").trim();
    assert(
      result.length >= min && result.length <= max,
      `${name} must be ${min}–${max} characters`,
    );
    return result;
  };
  assert(input && typeof input === "object", "Campaign details are required");
  assert(
    Number.isInteger(input.winners) &&
      input.winners >= 1 &&
      input.winners <= 100,
    "Choose 1 to 100 winners",
  );
  assert(
    Number.isInteger(input.reserves) &&
      input.reserves >= 0 &&
      input.reserves <= 100,
    "Choose 0 to 100 alternates",
  );
  assert(
    typeof input.listed === "boolean",
    "Choose whether to list the result publicly",
  );
  assert(
    /^0x[\da-f]{64}$/i.test(input.linkId),
    "Choose a verified Discord channel",
  );
  assert(
    Number.isInteger(input.endsAt) && input.endsAt > 0,
    "Choose a closing time",
  );
  return {
    title: text(input.title, 3, TITLE_MAX_LENGTH, "Title"),
    description: text(
      input.description ?? "",
      0,
      DESCRIPTION_MAX_LENGTH,
      "Description",
    ),
    rules: text(input.rules, 5, RULES_MAX_LENGTH, "Rules"),
    winners: input.winners,
    reserves: input.reserves,
    listed: input.listed,
    linkId: input.linkId.toLowerCase(),
    endsAt: input.endsAt,
  };
}
