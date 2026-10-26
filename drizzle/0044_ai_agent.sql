-- Steward agent: the owner's agent settings and schedule, plus a log of every
-- decision (buy, sell or hold, with the reason and anything that blocked it).
CREATE TABLE IF NOT EXISTS ai_agents (
  owner_ref TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_agents_due ON ai_agents(enabled, next_run_at);
CREATE TABLE IF NOT EXISTS ai_agent_log (
  id TEXT PRIMARY KEY,
  owner_ref TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_agent_log_owner ON ai_agent_log(owner_ref, created_at);
