import { hash } from "../shared/core";
import {
  discordApi,
  DiscordRateLimitError,
  type Campaign,
  type CampaignEnv,
} from "./discord-campaigns";
export function queueWinnerNotifications(
  env: CampaignEnv,
  row: Campaign,
  ids: string[],
) {
  if (
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => /^\d{17,20}$/.test(id))
  )
    throw new Error("Invalid verified winner identities");
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const users = ids.slice(start, start + 50),
      batch = start / 50,
      url = new URL(env.APP_ORIGIN).origin + "/g/" + row.id;
    const payload = {
      content: `🎉 Congratulations, ${users.map((id) => `<@${id}>`).join(" ")}! 🏆\nYou won! View the results and verify the draw: ${url}`,
      allowed_mentions: { parse: [], users, replied_user: false },
      message_reference: {
        message_id: row.message_id,
        fail_if_not_exists: false,
      },
      nonce: hash(["lottewy-winner-notice", row.id, batch]).slice(2, 26),
      enforce_nonce: true,
    };
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO discord_notifications(campaign_id,batch_index,payload_json) VALUES (?,?,?)",
      ).bind(row.id, batch, JSON.stringify(payload)),
    );
  }
  return statements;
}
export async function sendWinnerNotifications(
  env: CampaignEnv,
  row: Campaign,
  token: string,
) {
  const pending = await env.DB.prepare(
    "SELECT batch_index,payload_json,state FROM discord_notifications WHERE campaign_id=? AND (state='sending' OR (state='pending' AND retry_at<=unixepoch())) ORDER BY batch_index LIMIT 2",
  )
    .bind(row.id)
    .all<{ batch_index: number; payload_json: string; state: string }>();
  for (const notice of pending.results) {
    if (notice.state === "sending") {
      await env.DB.prepare(
        "UPDATE discord_notifications SET state='uncertain' WHERE campaign_id=? AND batch_index=? AND state='sending'",
      )
        .bind(row.id, notice.batch_index)
        .run();
      continue;
    }
    const claimed = await env.DB.prepare(
      "UPDATE discord_notifications SET state='sending',attempt_token=? WHERE campaign_id=? AND batch_index=? AND state='pending' AND retry_at<=unixepoch() AND EXISTS(SELECT 1 FROM discord_campaigns c JOIN giveaways g ON g.id=c.id WHERE c.id=? AND c.lease_token=? AND c.lease_until>unixepoch() AND g.status='completed' AND g.hidden=0)",
    )
      .bind(token, row.id, notice.batch_index, row.id, token)
      .run();
    if (!claimed.meta.changes) continue;
    try {
      const message = await discordApi(
        env,
        `/channels/${row.channel_id}/messages`,
        "POST",
        JSON.parse(notice.payload_json),
      );
      if (!/^\d{17,20}$/.test(message.id || ""))
        throw new Error("Missing message ID");
      await env.DB.prepare(
        "UPDATE discord_notifications SET state='sent',message_id=? WHERE campaign_id=? AND batch_index=? AND state='sending' AND attempt_token=?",
      )
        .bind(message.id, row.id, notice.batch_index, token)
        .run();
    } catch (error) {
      if (error instanceof DiscordRateLimitError) {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE discord_notifications SET state='pending',retry_at=unixepoch()+? WHERE campaign_id=? AND batch_index=? AND state='sending' AND attempt_token=?",
          ).bind(error.retryAfter, row.id, notice.batch_index, token),
          env.DB.prepare(
            "UPDATE discord_notifications SET retry_at=MAX(retry_at,unixepoch()+?) WHERE campaign_id=? AND state='pending' AND EXISTS(SELECT 1 FROM discord_campaigns WHERE id=? AND lease_token=?)",
          ).bind(error.retryAfter, row.id,row.id,token),
          env.DB.prepare(
            "UPDATE discord_campaigns SET error_code='DISCORD_RATE_LIMITED',checked_at=unixepoch()+? WHERE id=? AND lease_token=?",
          ).bind(error.retryAfter, row.id, token),
        ]);
      } else {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE discord_notifications SET state='uncertain' WHERE campaign_id=? AND batch_index=? AND state='sending' AND attempt_token=?",
          ).bind(row.id, notice.batch_index, token),
          env.DB.prepare(
            "UPDATE discord_campaigns SET error_code='WINNER_NOTIFICATION_UNCERTAIN' WHERE id=? AND lease_token=?",
          ).bind(row.id, token),
        ]);
      }
      break;
    }
  }
  await env.DB.prepare(
    "UPDATE discord_campaigns SET error_code=CASE WHEN EXISTS(SELECT 1 FROM discord_notifications WHERE campaign_id=? AND state='uncertain') THEN 'WINNER_NOTIFICATION_UNCERTAIN' WHEN NOT EXISTS(SELECT 1 FROM discord_notifications WHERE campaign_id=? AND state IN ('pending','sending')) THEN NULL ELSE error_code END WHERE id=? AND lease_token=?",
  )
    .bind(row.id, row.id, row.id, token)
    .run();
}
