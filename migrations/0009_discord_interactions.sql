CREATE TABLE discord_interactions (
  id TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX discord_interactions_expiry ON discord_interactions(expires);
