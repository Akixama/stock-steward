-- Panic guard for automatic mode: owner settings plus the tracked high,
-- starting value and any active cool-off for the current permission.
CREATE TABLE IF NOT EXISTS panic_guards (
  owner_ref TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  state_json TEXT,
  updated_at TEXT NOT NULL
);
