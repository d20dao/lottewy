ALTER TABLE attempts ADD COLUMN attempt_id TEXT;
UPDATE attempts SET attempt_id=lower(hex(randomblob(16))) WHERE attempt_id IS NULL;
CREATE UNIQUE INDEX attempts_identity ON attempts(attempt_id);
ALTER TABLE attempts ADD COLUMN fulfillment_scan_block TEXT;
ALTER TABLE attempts ADD COLUMN last_error TEXT;
ALTER TABLE giveaways ADD COLUMN chain_checked_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE giveaways ADD COLUMN sync_lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE giveaways ADD COLUMN sync_lease_token TEXT;
CREATE INDEX giveaway_sync_queue ON giveaways(status,chain_checked_at);
