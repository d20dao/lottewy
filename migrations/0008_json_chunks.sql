CREATE TABLE json_chunks (
  object_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(object_key,part)
);
