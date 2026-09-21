ALTER TABLE giveaways ADD COLUMN listed INTEGER NOT NULL DEFAULT 0 CHECK(listed IN (0,1));
CREATE INDEX giveaways_listed_created ON giveaways(listed,created,id);
