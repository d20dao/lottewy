ALTER TABLE rate_limits ADD COLUMN expires INTEGER NOT NULL DEFAULT 0;
CREATE INDEX rate_limits_expiry ON rate_limits(expires);
