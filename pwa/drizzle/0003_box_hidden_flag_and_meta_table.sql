ALTER TABLE boxes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
