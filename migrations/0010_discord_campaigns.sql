CREATE TABLE discord_links (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,
 verifier_id TEXT NOT NULL,guild_name TEXT NOT NULL,channel_name TEXT NOT NULL,verified_at INTEGER NOT NULL,
 UNIQUE(owner,guild_id,channel_id)
);
CREATE TABLE discord_campaigns (
 id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL,
 input_json TEXT NOT NULL,payload_hash TEXT NOT NULL,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,
 ends_at INTEGER NOT NULL,created INTEGER NOT NULL,participant_count INTEGER NOT NULL DEFAULT 0,
 message_id TEXT,message_state TEXT,publish_started_at INTEGER,closed_at INTEGER,review_json TEXT NOT NULL,
 error_code TEXT,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX discord_campaigns_owner ON discord_campaigns(owner,created);
CREATE INDEX discord_campaigns_work ON discord_campaigns(status,checked_at);
CREATE TABLE discord_entries (
 campaign_id TEXT NOT NULL REFERENCES discord_campaigns(id),user_id TEXT NOT NULL,
 display_name TEXT NOT NULL,joined_at INTEGER NOT NULL,PRIMARY KEY(campaign_id,user_id)
);
