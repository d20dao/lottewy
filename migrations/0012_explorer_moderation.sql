ALTER TABLE giveaways ADD COLUMN explorer_hidden INTEGER NOT NULL DEFAULT 0;
CREATE INDEX giveaways_explorer_visible ON giveaways(listed,hidden,explorer_hidden,created);
