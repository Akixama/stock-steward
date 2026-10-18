CREATE TABLE IF NOT EXISTS wallet_action_attempts (
  id TEXT PRIMARY KEY,
  owner_ref TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  safe TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sell','transfer')),
  symbol TEXT NOT NULL,
  quantity TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  transaction_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','submitted','confirmed','reverted','unknown')),
  transaction_hash TEXT,
  execution_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wallet_action_attempts_owner ON wallet_action_attempts(owner_ref, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_action_attempts_hash ON wallet_action_attempts(transaction_hash) WHERE transaction_hash IS NOT NULL;
