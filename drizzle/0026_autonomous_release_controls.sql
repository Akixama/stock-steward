CREATE TABLE autonomous_fee_consents (
 owner_ref TEXT NOT NULL, grant_id TEXT NOT NULL, consent_json TEXT NOT NULL,
 signature TEXT NOT NULL, issued_at TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_ref,grant_id)
);
CREATE TABLE autonomous_release_evidence (
 owner_ref TEXT NOT NULL, grant_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('eligibility','security','rehearsal')),
 evidence_json TEXT NOT NULL, signature TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_ref,grant_id,kind)
);
