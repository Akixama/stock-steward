CREATE TABLE IF NOT EXISTS permission_maintenance_attempts (
  id TEXT PRIMARY KEY,
  owner_ref TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  safe TEXT NOT NULL,
  module TEXT NOT NULL,
  mandate_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('renew','revoke')),
  state TEXT NOT NULL CHECK (state IN ('prepared','submitted','unknown','confirmed','reverted')),
  transaction_json TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  transaction_hash TEXT,
  starts_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS permission_maintenance_owner ON permission_maintenance_attempts(owner_ref,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS permission_maintenance_hash ON permission_maintenance_attempts(transaction_hash) WHERE transaction_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS permission_maintenance_one_open ON permission_maintenance_attempts(owner_ref,safe)
  WHERE state IN ('prepared','submitted','unknown');
