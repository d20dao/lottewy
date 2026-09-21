ALTER TABLE attempts ADD COLUMN sender_nonce INTEGER;
ALTER TABLE attempts ADD COLUMN consumer TEXT;
ALTER TABLE attempts ADD COLUMN cancel_hash TEXT;
CREATE TABLE attempt_history (id INTEGER PRIMARY KEY AUTOINCREMENT, giveaway_id TEXT NOT NULL, outcome TEXT NOT NULL, snapshot_json TEXT NOT NULL, tx_hash TEXT NOT NULL, observed INTEGER NOT NULL);
