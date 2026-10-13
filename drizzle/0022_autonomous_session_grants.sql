CREATE TABLE autonomous_session_grants (
 owner_ref TEXT PRIMARY KEY NOT NULL,
 id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('draft','verified','paused','revoked')),
 session_address TEXT NOT NULL,
 mandate_version INTEGER NOT NULL,
 policy_json TEXT NOT NULL,
 lease_json TEXT NOT NULL,
 transaction_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
