CREATE TABLE abuse_buckets (
  wallet TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count>=1),
  expires INTEGER NOT NULL,
  PRIMARY KEY(wallet,bucket)
);
CREATE INDEX abuse_buckets_expiry ON abuse_buckets(expires);
