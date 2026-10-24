-- One-signature automatic setup: choices made on the setup screen before the
-- owner signs the wallet permission. Read once when that installation verifies.
CREATE TABLE IF NOT EXISTS autonomous_setup_choices (
  owner_ref TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  max_fee_cents INTEGER NOT NULL CHECK (max_fee_cents BETWEEN 1 AND 1000),
  days INTEGER NOT NULL CHECK (days IN (2,7,14,30)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_ref, grant_id)
);
