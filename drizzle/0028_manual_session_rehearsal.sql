CREATE TABLE autonomous_rehearsal_intents (
 id TEXT PRIMARY KEY NOT NULL, owner_ref TEXT NOT NULL, plan_revision INTEGER NOT NULL,
 preparation_json TEXT NOT NULL, message TEXT NOT NULL, expires_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','attempting','submitted','unknown','blocked')),
 transaction_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX autonomous_rehearsal_owner ON autonomous_rehearsal_intents(owner_ref,created_at);
