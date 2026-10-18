CREATE TABLE IF NOT EXISTS trading_controls (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO trading_controls (id, disabled) VALUES (1, 0);
