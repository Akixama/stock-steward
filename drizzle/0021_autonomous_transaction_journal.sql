CREATE TABLE autonomous_transaction_journal (
 intent_id TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 session_address TEXT NOT NULL,
 nonce INTEGER NOT NULL CHECK(nonce>=0),
 transaction_hash TEXT NOT NULL UNIQUE,
 raw_transaction TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('signed','broadcasting','submitted','unknown')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(session_address,nonce)
);
CREATE TABLE autonomous_account_locks (
 account_address TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 intent_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
);
