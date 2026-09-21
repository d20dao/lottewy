// Preserve signed audit records and a small ID tombstone; remove undrawn rosters.
export async function expireDiscordRegistrations(env: { DB: D1Database }) {
  const eligible = `status IN ('publishing','publishing_uncertain','open','closing','ready','insufficient','cancelled') AND CASE WHEN status='cancelled' THEN COALESCE(closed_at,ends_at) ELSE ends_at END<=unixepoch()-2592000 AND lease_until<unixepoch()
 AND NOT EXISTS(SELECT 1 FROM attempts WHERE giveaway_id=discord_campaigns.id)
 AND NOT EXISTS(SELECT 1 FROM chain_events WHERE giveaway_id=discord_campaigns.id)
 AND NOT EXISTS(SELECT 1 FROM giveaways WHERE id=discord_campaigns.id AND status<>'draft')
 AND NOT EXISTS(SELECT 1 FROM actions WHERE target=discord_campaigns.id AND action_type='start')`;
  const rows = await env.DB.prepare(
    `SELECT id,ends_at FROM discord_campaigns WHERE ${eligible} ORDER BY ends_at LIMIT 10`,
  ).all<{ id: string; ends_at: number }>();
  for (const row of rows.results) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE discord_campaigns SET status='expired',input_json=?,participant_count=0,review_json='{}',error_code=NULL,lease_token=NULL,lease_until=0 WHERE id=? AND ${eligible}`,
        ).bind(
          JSON.stringify({
            title: "Expired registration",
            description: "",
            rules: "Expired. No draw was started.",
            winners: 1,
            reserves: 0,
            listed: false,
            endsAt: row.ends_at,
          }),
          row.id,
        ),
        env.DB.prepare(
          "INSERT INTO atomic_guard(ok) VALUES(CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
        ),
        env.DB.prepare("DELETE FROM discord_entries WHERE campaign_id=?").bind(
          row.id,
        ),
        env.DB.prepare("DELETE FROM reports WHERE giveaway_id=?").bind(row.id),
        env.DB.prepare("DELETE FROM revisions WHERE giveaway_id=?").bind(
          row.id,
        ),
        env.DB.prepare("DELETE FROM giveaways WHERE id=?").bind(row.id),
        env.DB.prepare("DELETE FROM json_chunks WHERE object_key=?").bind(
          "discord-private:" + row.id,
        ),
        env.DB.prepare("DELETE FROM atomic_guard"),
      ]);
    } catch {
      /* A concurrent signed start wins safely; retry eligibility next time. */
    }
  }
}
