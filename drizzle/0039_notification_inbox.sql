CREATE TABLE IF NOT EXISTS notification_inbox (
  id TEXT PRIMARY KEY,
  owner_ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('test','price','proposal')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  symbol TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notification_inbox_owner ON notification_inbox(owner_ref,created_at DESC);
