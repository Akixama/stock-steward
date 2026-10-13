CREATE TABLE autonomous_activation (
 owner_ref TEXT NOT NULL, grant_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('armed','paused')),
 consent_json TEXT NOT NULL, signature TEXT NOT NULL, issued_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_ref,grant_id)
);
