CREATE TABLE autonomous_incidents (
 id TEXT PRIMARY KEY NOT NULL,
 owner_ref TEXT NOT NULL,
 kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
 message TEXT NOT NULL,
 created_at TEXT NOT NULL,
 acknowledged_at TEXT,
 UNIQUE(owner_ref,kind,subject_id)
);
CREATE INDEX autonomous_incidents_owner ON autonomous_incidents(owner_ref,created_at);
