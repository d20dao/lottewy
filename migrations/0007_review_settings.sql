CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO app_settings(key,value) VALUES ('jev_enabled','true');
