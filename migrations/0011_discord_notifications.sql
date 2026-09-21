CREATE TABLE discord_notifications (
 campaign_id TEXT NOT NULL REFERENCES discord_campaigns(id),
 batch_index INTEGER NOT NULL,
 payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending',
 retry_at INTEGER NOT NULL DEFAULT 0,
 attempt_token TEXT,
 message_id TEXT,
 PRIMARY KEY(campaign_id,batch_index)
);
CREATE INDEX discord_notifications_work ON discord_notifications(state,retry_at);
